import { useEffect, useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SeverityLabel } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { useTheme } from '@/hooks/use-theme';
import { buildDocsHtml, buildDocsText } from '@/lib/docs-template.js';
import { reportProblem } from '@/lib/feedback.js';
import { buildReviewFile, cleanFigmaLink, cleanJiraLink } from '@/lib/review-file.js';
import { buildReport, renderBody } from '@/lib/report-template.js';
import { SEVERITIES, severityOf } from '@/lib/severity.js';
import { buildMarkdown, commentHtml, commentMarkdown } from '@/lib/share-template.js';
import { STATUSES, statusOf } from '@/lib/status.js';
import { addGroup, patchGroup, readRaw } from '@/lib/store.js';
import { queryClient } from '@/lib/query';
import { cn } from '@/lib/utils';
import { ConfirmProvider, useConfirm } from './confirm';
import { ControlsDialog } from './controls-dialog';
import { EditCommentsDialog } from './edit-comments-dialog';
import { ImageEditor, type ImageEditorHandle } from './editor/image-editor';
import type { StatusKey } from './export/config';
import { ExportSettingsDialog } from './export/export-settings-dialog';
import { MarkerNote } from './marker-note';
import { PointMenu } from './point-menu';
import { Preview, type PreviewEvents, type PreviewHandle, type ShotClick } from './preview/preview';
import { patchCached, useTourSeen, useUpdateComment } from './queries';
import { RecheckDialog, startRecheck, useRecheckBusy } from './recheck-dialog';
import { ReviewSheetDialog } from './review-sheet/review-sheet-dialog';
import { FigmaDialog } from './send/figma-dialog';
import { JiraDialog } from './send/jira-dialog';
import { Sidebar } from './sidebar';
import { PreviewSkeleton, ReportSkeleton } from './skeleton';
import { NO_FILTERS, useReportUi, type Dialog } from './store';
import { TopBar, type Actions } from './top-bar';
import { Tour, type TourStep } from './tour';
import type { Issue, Mark } from './types';
import { useReport, type Report } from './use-report';
import { copyText, hostOf, pad, saveBlob, send } from './util';

const ALL_STATUSES: StatusKey[] = ['open', 'fixed', 'wontfix'];

/** The report screen: every comment in a review, edited in place and handed over from one Share button. */
export function ReportApp() {
  return (
    <TooltipProvider delay={400}>
      <ConfirmProvider>
        <ReportScreen />
        <Toaster position="bottom-center" />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

function ReportScreen() {
  const report = useReport();
  return report ? <Loaded report={report} /> : <ReportSkeleton />;
}

/** Keeps a comment's markers and images from a background reply in the cached comments, ahead of the storage refresh. */
const applyMarks = (issue: Issue, res: { marks: Mark[]; shot?: string; detail?: string }) =>
  patchCached(issue.id, { marks: res.marks, ...(res.shot ? { shot: res.shot, detail: res.detail } : {}) });

function closeCardMenu() {
  const { cardMenu, set } = useReportUi.getState();
  cardMenu?.chip.setAttribute('aria-expanded', 'false');
  set({ cardMenu: null });
}

function Loaded({ report }: { report: Report }) {
  const { issues, ordered, sections, numberOf, group, groupId, groups, exportOptions, sortOrder, basename, title, config } = report;
  const ui = useReportUi();
  const { set, filters, cardMenu } = ui;
  const confirm = useConfirm();
  const theme = useTheme();
  const update = useUpdateComment();
  const tourSeen = useTourSeen('report');
  const rechecking = useRecheckBusy(groupId);
  const preview = useRef<PreviewHandle>(null);
  const editor = useRef<ImageEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const html = useMemo(() => renderBody(issues, { ...exportOptions, statuses: ALL_STATUSES, order: sortOrder, preview: true }), [issues, exportOptions, sortOrder]);

  // A filter on a severity or status that no comment has any more shows everything.
  const severity = ordered.some((i) => severityOf(i.severity).key === filters.severity) ? filters.severity : 'all';
  const status = ordered.some((i) => statusOf(i.status).key === filters.status) ? filters.status : 'all';
  const term = filters.term.trim().toLowerCase();
  const visible = ordered.map((issue) => {
    const text = `${pad(numberOf(issue))} ${issue.title ?? ''} ${issue.note ?? ''} ${issue.element?.selector ?? ''} ${issue.jira?.key ?? ''} ${hostOf(issue.page?.url)}`.toLowerCase();
    return (severity === 'all' || severityOf(issue.severity).key === severity) && (status === 'all' || statusOf(issue.status).key === status) && (!term || text.includes(term));
  });
  const noMatch = term ? `No comments match "${filters.term.trim()}"` : 'No comments match these filters';
  const editing = issues.find((i) => i.id === ui.editingId) ?? null;
  const counts = Object.fromEntries(ALL_STATUSES.map((key) => [key, issues.filter((i) => statusOf(i.status).key === key).length])) as Record<StatusKey, number>;
  const touring = ui.previewReady && (ui.touring || tourSeen.data === false);
  const menuIssue = cardMenu ? ordered[cardMenu.index] : null;
  const openDialog = (dialog: Dialog) => (open: boolean) => set({ dialog: open ? dialog : null });

  /** Offers to put back a comment's markers as they were before a removal. */
  const offerUndo = (issue: Issue, before: Mark[], index: number) =>
    toast(`Removed marker ${index + 1} from comment ${pad(numberOf(issue))}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const res = await send('annotate', { id: issue.id, marks: before, rect: issue.rect });
          if (res?.error) return toast.error(res.error);
          applyMarks(issue, { marks: before, shot: res.shot, detail: res.detail });
        },
      },
    });

  const dropMark = async (issue: Issue, index: number) => {
    const res = await send('quickMark', { id: issue.id, action: 'drop', index });
    if (res?.marks) applyMarks(issue, res);
  };

  const removeMark = async (issue: Issue, index: number) => {
    const before = structuredClone(issue.marks ?? []);
    await dropMark(issue, index);
    offerUndo(issue, before, index);
  };

  /** Closes the note box. A marker placed a moment ago that still has no note is removed. */
  const dismissNote = () => {
    const ask = useReportUi.getState().noteAsk;
    if (!ask) return;
    set({ noteAsk: null });
    const issue = issues.find((i) => i.id === ask.issueId);
    if (ask.fresh && issue) dropMark(issue, ask.index);
  };

  /** Saves an edit made on the card and offers Undo, so editing in place is safe to try. */
  const saveField = (issue: Issue, patch: Partial<Issue>, what: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, issue[key as keyof Issue] ?? (key === 'status' ? 'open' : '')]));
    update.mutate({ id: issue.id, patch });
    toast(`${what} saved for comment ${pad(numberOf(issue))}`, { action: { label: 'Undo', onClick: () => update.mutate({ id: issue.id, patch: before }) } });
  };

  const jumpTo = async (index: number) => {
    set({ current: index, sidebarOpen: false });
    if (editing) {
      if (!(await editor.current?.requestClose())) return;
      preview.current?.jumpTo(index, 'instant');
      if (ordered[index]?.shot) set({ editingId: ordered[index].id });
      return;
    }
    preview.current?.jumpTo(index);
  };

  const shotClick = async (index: number, click: ShotClick, action: 'add' | 'remove') => {
    const issue = ordered[index];
    if (!issue?.shot) return;
    dismissNote();
    const before = structuredClone(issue.marks ?? []);
    const { at, ...geometry } = click;
    const res = await send('quickMark', { id: issue.id, action, ...geometry });
    if (res?.error) return toast.error(res.error);
    if (res.stale) {
      applyMarks(issue, res);
      return toast('The image was redrawn with the current crop. Click again to place the marker.');
    }
    if (res.index == null) {
      if (action === 'remove') toast('No marker here. Right-click on a number to remove it.');
      return;
    }
    applyMarks(issue, res);
    if (action === 'add') set({ noteAsk: { issueId: issue.id, index: res.index, at, fresh: true, note: '' } });
    else offerUndo(issue, before, res.index);
  };

  const copyOut = async (plain: string, rich: string | undefined, done: string) => {
    try {
      await copyText(plain, rich);
      toast.success(done);
    } catch {
      toast.error('Copy failed. Try again with this tab in front.');
    }
  };

  const events: PreviewEvents = {
    onLoad: () => {
      set({ previewReady: true });
      const jump = new URL(location.href).searchParams.get('comment');
      const index = jump ? ordered.findIndex((issue) => issue.id === jump) : -1;
      if (index < 0) return;
      set({ current: index });
      preview.current?.jumpTo(index, 'instant');
    },
    onField: (index, field, value) => {
      const issue = ordered[index];
      if (issue && (issue[field] ?? '') !== value) saveField(issue, { [field]: value }, field === 'title' ? 'Title' : 'Note');
    },
    onMenu: (index, kind, chip) => {
      const frame = preview.current?.frameRect();
      if (!frame) return;
      const r = chip.getBoundingClientRect();
      chip.setAttribute('aria-expanded', 'true');
      set({ cardMenu: { index, kind, chip, at: { x: frame.left + r.left, y: frame.top + r.top, w: r.width, h: r.height } } });
    },
    onAnnotate: (index) => ordered[index]?.shot && set({ editingId: ordered[index].id }),
    onCopy: (index) => {
      const issue = ordered[index];
      if (!issue) return;
      const share = { ...exportOptions, number: numberOf(issue) };
      copyOut(commentMarkdown(issue, share), commentHtml(issue, share), `Copied comment ${pad(numberOf(issue))}`);
    },
    onShotClick: shotClick,
    onMarkEdit: (index, mark, at) => {
      const issue = ordered[index];
      if (issue) set({ noteAsk: { issueId: issue.id, index: mark, at, fresh: false, note: issue.marks?.[mark]?.note ?? '' } });
    },
    onMarkRemove: (index, mark) => ordered[index] && removeMark(ordered[index], mark),
    onClearFilters: () => set({ filters: NO_FILTERS }),
    onSpy: (current) => set({ current }),
    onPointerDown: () => {
      dismissNote();
      closeCardMenu();
    },
    onHelpKey: () => set({ dialog: 'controls' }),
  };

  const tourSteps: TourStep[] = [
    { target: '[data-tour="picker"]', title: 'One review per round', body: 'Each review holds one round of comments. Switch reviews or start a new one here.' },
    { target: '[data-tour="sidebar"]', title: 'Every comment', body: 'Sorted by severity or by number. Search or filter, then click one to jump to it.' },
    {
      target: () => preview.current?.firstShotRect() ?? null,
      reveal: () => preview.current?.revealFirstShot(),
      title: 'Edit right on the card',
      body: 'Click a screenshot to drop a numbered marker, or Annotate for boxes and arrows. Click a title, a note, the severity or the status to change it.',
    },
    { target: '[data-tour="share"]', title: 'Hand it over', body: 'Copy for Docs pastes the whole review into Google Docs. The arrow has Word, HTML, Markdown, Jira and Figma.' },
    { target: '[data-tour="more"]', title: 'Everything else', body: 'Rename the review, edit every comment at once, open a review file, and this tour again.' },
  ];

  const actions: Actions = {
    copyDocs: () => copyOut(buildDocsText(issues, exportOptions), buildDocsHtml(issues, exportOptions), 'Copied. Paste it into Google Docs.'),
    word: () => {
      saveBlob(new Blob([buildDocsHtml(issues, exportOptions)], { type: 'application/msword' }), `${basename}.doc`);
      toast.success(`Downloaded ${basename}.doc`, { description: 'Word opens it with a note about the format. Choose Yes.' });
    },
    html: () => {
      saveBlob(new Blob([buildReport(issues, exportOptions)], { type: 'text/html' }), `${basename}.html`);
      toast.success(`Downloaded ${basename}.html`);
    },
    markdown: () => copyOut(buildMarkdown(issues, exportOptions), undefined, 'Copied the review as Markdown'),
    print: () => preview.current?.print(),
    jira: () => set({ dialog: 'jira' }),
    figma: () => set({ dialog: 'figma' }),
    saveFile: async () => {
      const id = toast.loading('Saving the review file');
      const raws = Object.fromEntries(await Promise.all(issues.map(async (issue) => [issue.id, await readRaw(issue.id)])));
      const blob = new Blob([buildReviewFile((group ?? { name: title }) as { name: string }, issues, raws)], { type: 'application/json' });
      saveBlob(blob, `${basename}.margin.json`);
      toast.success(`Saved ${basename}.margin.json, ${(blob.size / 1048576).toFixed(1)} MB`, { id });
    },
    openFile: () => fileInput.current?.click(),
    exportSettings: () => set({ dialog: 'export' }),
    recheck: async () => {
      const problem = await startRecheck(groupId);
      if (problem) toast.error(problem);
    },
    rename: () => set({ sheet: { mode: 'edit', focus: 'name' } }),
    editLinks: () => set({ sheet: { mode: 'edit', focus: group?.jira ? 'figma' : 'jira' } }),
    editComments: () => set({ dialog: 'edit' }),
    recrop: async () => {
      const id = toast.loading('Redoing crops');
      const res = await send('recropGroup', { groupId });
      if (res?.error) return toast.error(`Redoing crops failed. ${res.error}`, { id });
      toast.success(`Redid ${res.updated} ${res.updated === 1 ? 'crop' : 'crops'}`, { id });
    },
    tour: () => set({ touring: true }),
    reportProblem: () => reportProblem('report'),
    help: () => chrome.runtime.openOptionsPage(),
    controls: () => set({ dialog: 'controls' }),
    deleteReview: async () => {
      if (!group) return;
      const count = groups.find((g) => g.id === group.id)?.count ?? issues.length;
      const choice = await confirm({
        title: `Delete ${group.name}?`,
        body: `This deletes the review and its ${count} ${count === 1 ? 'comment' : 'comments'} with their screenshots. Save a review file first to keep a copy.`,
        buttons: [
          { label: 'Cancel', value: null },
          { label: 'Delete review', value: 'delete', kind: 'destructive' },
        ],
      });
      if (choice !== 'delete') return;
      await send('groupDelete', { id: group.id });
      location.search = '';
    },
    newReview: () => set({ sheet: { mode: 'new', focus: 'name' } }),
    pickReview: (id) => {
      location.search = `?group=${id}`;
    },
    toggleSidebar: () => set({ sidebarOpen: !ui.sidebarOpen }),
  };

  // The page's one keyboard listener: ? opens the controls from anywhere but a field, a dialog or a menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as Element;
      if (event.key !== '?' || target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"], [role="menu"]')) return;
      useReportUi.getState().set({ dialog: 'controls' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <title>{title}</title>
      <a
        href="#comments"
        onClick={(e) => {
          e.preventDefault();
          set({ sidebarOpen: true });
          requestAnimationFrame(() => (document.querySelector<HTMLElement>('#comments button') ?? document.getElementById('comments'))?.focus());
        }}
        className="fixed top-2 left-2 z-[70] -translate-y-[200%] rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Skip to comments
      </a>
      <TopBar groups={groups} groupId={groupId} group={group} empty={!issues.length} rechecking={rechecking} actions={actions} />
      <div className="relative flex min-h-0 flex-1">
        {ui.sidebarOpen && <button type="button" aria-label="Hide comments" className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => set({ sidebarOpen: false })} />}
        <Sidebar
          ordered={ordered}
          sections={sections}
          numberOf={numberOf}
          visible={visible}
          filters={{ ...filters, severity, status }}
          onFilters={ui.setFilters}
          sortOrder={sortOrder}
          onSort={ui.setSortOrder}
          current={ui.current}
          onJump={jumpTo}
          showHost={!groupId || sortOrder === 'number'}
          className={cn(
            'w-72 shrink-0 border-r border-sidebar-border max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[min(18rem,85vw)] max-md:shadow-lg max-md:transition-transform max-md:duration-200',
            !ui.sidebarOpen && 'max-md:-translate-x-full',
          )}
        />
        <main className="relative min-w-0 flex-1 bg-background">
          <Preview ref={preview} html={html} theme={theme} visible={visible} noMatch={noMatch} events={events} className={cn('transition-opacity duration-200', !ui.previewReady && 'opacity-0')} />
          {!ui.previewReady && <PreviewSkeleton className="absolute inset-0" />}
        </main>
      </div>

      <ImageEditor ref={editor} issue={editing} label={editing ? `Annotate comment ${pad(numberOf(editing))}` : ''} onSaved={patchCached} onClosed={() => set({ editingId: null })} />
      <MarkerNote
        ask={ui.noteAsk}
        onDismiss={dismissNote}
        onSave={async (note) => {
          const ask = ui.noteAsk!;
          set({ noteAsk: null });
          const issue = issues.find((i) => i.id === ask.issueId);
          const res = await send('markNote', { id: ask.issueId, index: ask.index, note });
          if (issue && res?.marks) applyMarks(issue, res);
        }}
        onRemove={() => {
          const ask = ui.noteAsk!;
          set({ noteAsk: null });
          const issue = issues.find((i) => i.id === ask.issueId);
          if (!issue) return;
          if (ask.fresh) dropMark(issue, ask.index);
          else removeMark(issue, ask.index);
        }}
      />
      <PointMenu at={cardMenu?.at ?? null} onClose={closeCardMenu} returnFocus={() => cardMenu?.chip ?? null} label={cardMenu?.kind === 'status' ? 'Status' : 'Severity'} className="w-40">
        {menuIssue &&
          cardMenu &&
          ((cardMenu.kind === 'severity' ? SEVERITIES : STATUSES) as { key: string }[]).map((option) => {
            const chosen = cardMenu.kind === 'severity' ? severityOf(menuIssue.severity).key === option.key : statusOf(menuIssue.status).key === option.key;
            return (
              <DropdownMenuItem key={option.key} onClick={() => !chosen && saveField(menuIssue, { [cardMenu.kind]: option.key }, cardMenu.kind === 'severity' ? 'Severity' : 'Status')}>
                {cardMenu.kind === 'severity' ? <SeverityLabel severity={option.key} className="text-sm" /> : <StatusLabel status={option.key} className="text-sm" />}
                <Check className={cn('ml-auto', !chosen && 'invisible')} />
              </DropdownMenuItem>
            );
          })}
      </PointMenu>

      <ReviewSheetDialog
        sheet={ui.sheet}
        group={group}
        onClose={() => set({ sheet: null })}
        onSubmit={async ({ name, jira, figma }) => {
          const links = { jira: cleanJiraLink(jira), figma: cleanFigmaLink(figma) };
          if (ui.sheet?.mode === 'edit' && group) {
            await patchGroup(group.id, { name, ...links });
            set({ sheet: null });
            toast.success('Review saved');
            return;
          }
          const created = await addGroup(name);
          await patchGroup(created.id, links);
          location.search = `?group=${created.id}&created=1`;
        }}
      />
      <ExportSettingsDialog open={ui.dialog === 'export'} onOpenChange={openDialog('export')} config={config} counts={counts} />
      <EditCommentsDialog open={ui.dialog === 'edit'} onOpenChange={openDialog('edit')} ordered={ordered} numberOf={numberOf} />
      <RecheckDialog groupId={groupId} ordered={ordered} numberOf={numberOf} />
      <JiraDialog open={ui.dialog === 'jira'} onOpenChange={openDialog('jira')} ordered={ordered} numberOf={numberOf} group={group} shots={exportOptions.shots} reviewTitle={title} />
      <FigmaDialog open={ui.dialog === 'figma'} onOpenChange={openDialog('figma')} ordered={ordered} numberOf={numberOf} group={group} />
      <ControlsDialog open={ui.dialog === 'controls'} onOpenChange={openDialog('controls')} onTour={() => set({ touring: true })} />
      {touring && (
        <Tour
          name="report"
          steps={tourSteps}
          onDone={() => {
            queryClient.setQueryData(['tour-seen', 'report'], true);
            set({ touring: false });
          }}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const res = await send('importReview', { contents: await file.text() });
          if (res?.error) return toast.error(`${file.name} could not be opened. ${res.error}`, { duration: 9000 });
          location.search = `?group=${res.group.id}`;
        }}
      />
    </div>
  );
}
