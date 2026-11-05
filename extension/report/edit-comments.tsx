import { useState } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import { ImageIcon, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SEVERITIES, severityOf, STATUSES, statusOf } from './shared';
import { cn } from '@/lib/utils';
import type { Comment, CommentStatus, Severity } from '@/lib/model';
import { ask, useImages } from './data';
import { confirm } from './confirm';
import { closeDialog, useReportUi } from './ui-store';
import { useReportComments } from './use-report';
import { pad, plural } from './format';
import { openEditor } from './editor/editor-store';
import { SeverityDot } from './badges';

interface Draft {
  severity: Severity;
  status: CommentStatus;
  title: string;
  note: string;
  links: string;
  remove: boolean;
}

const SEVERITY_ITEMS = SEVERITIES.map((sev) => ({ value: sev.key, label: sev.label }));
const STATUS_ITEMS = STATUSES.map((entry) => ({ value: entry.key, label: entry.label }));

/**
 * Reads a links field. Bare addresses such as figma.com/design/... get https:// in front.
 * @param value What was typed.
 */
export function parseLinks(value: string) {
  const links: string[] = [];
  const bad: string[] = [];
  for (const part of value.split(/[\s,]+/).filter(Boolean)) {
    if (/^https?:\/\/\S+\.\S+/i.test(part)) links.push(part);
    else if (/^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(part)) links.push(`https://${part}`);
    else bad.push(part);
  }
  return { links, bad };
}

/**
 * A comment's fields as the form starts with them.
 * @param comment The stored comment.
 */
const draftOf = (comment: Comment): Draft => ({
  severity: severityOf(comment.severity).key,
  status: statusOf(comment.status).key,
  title: comment.title ?? '',
  note: comment.note ?? '',
  links: (comment.links ?? []).join(' '),
  remove: false,
});

/**
 * True when a row differs from the stored comment.
 * @param comment The stored comment.
 * @param draft The row.
 */
const changed = (comment: Comment, draft: Draft) => draft.remove || JSON.stringify(draftOf(comment)) !== JSON.stringify(draft);

/**
 * The marked region of a comment with a button into the image editor.
 * @param props.comment The comment.
 * @param props.number Its number.
 * @param props.disabled True while the row is staged for deletion.
 */
function RegionThumb({ comment, number, disabled }: { comment: Comment; number: number; disabled: boolean }) {
  const detail = useImages(comment.id).data?.detail;
  const count = comment.marks?.length ?? 0;
  const open = () => !disabled && openEditor(comment, number);
  return (
    <div className="flex flex-wrap items-end gap-3">
      {detail && (
        <button type="button" onClick={open} disabled={disabled} className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <img src={detail} alt={`Marked region of comment ${number}. Click to edit the image.`} className="block max-h-28 max-w-56 rounded-lg border" />
        </button>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-xs text-muted-foreground">{count ? `${plural(count, 'numbered annotation', 'numbered annotations')}` : 'No annotations yet'}</span>
        <Button size="sm" variant="outline" onClick={open} disabled={disabled}>
          <ImageIcon />
          Edit image
        </Button>
      </div>
    </div>
  );
}

/**
 * One editable comment: severity, status, title, note and links, with its page for context.
 * @param props.comment The stored comment.
 * @param props.number Its number.
 * @param props.draft The row's values.
 * @param props.linkError The links that are not links, when Save found some.
 * @param props.onChange Called with the row's new values.
 */
function EditRow({
  comment,
  number,
  draft,
  linkError,
  onChange,
}: {
  comment: Comment;
  number: number;
  draft: Draft;
  linkError: string[] | undefined;
  onChange: (draft: Draft) => void;
}) {
  const label = pad(number);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className={cn('grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-b py-4 last:border-b-0', draft.remove && 'opacity-50')} data-edit-row={comment.id}>
      <span className="pt-2 text-xs font-extrabold text-muted-foreground tabular-nums">{label}</span>
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Select items={SEVERITY_ITEMS} value={draft.severity} disabled={draft.remove} onValueChange={(value) => value && set({ severity: value as Severity })}>
            <SelectTrigger size="sm" aria-label={`Severity of comment ${label}`}>
              <SeverityDot severity={draft.severity} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <SeverityDot severity={item.value} />
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={STATUS_ITEMS} value={draft.status} disabled={draft.remove} onValueChange={(value) => value && set({ status: value as CommentStatus })}>
            <SelectTrigger size="sm" aria-label={`Status of comment ${label}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input value={draft.title} disabled={draft.remove} placeholder="What is wrong" aria-label={`Title of comment ${label}`} onChange={(event) => set({ title: event.target.value })} />
        <Textarea
          value={draft.note}
          disabled={draft.remove}
          placeholder="Expected, actual, steps"
          aria-label={`Note of comment ${label}`}
          className="field-sizing-content min-h-16"
          onChange={(event) => set({ note: event.target.value })}
        />
        <Field data-invalid={linkError ? true : undefined}>
          <Input
            value={draft.links}
            disabled={draft.remove}
            aria-invalid={linkError ? true : undefined}
            placeholder="Links, such as a Figma frame, optional"
            aria-label={`Links of comment ${label}`}
            onChange={(event) => set({ links: event.target.value })}
          />
          {linkError && (
            <FieldError>
              {linkError.join(' and ')} {linkError.length === 1 ? 'is not a link' : 'are not links'}. Paste the full address, starting with https://
            </FieldError>
          )}
        </Field>
        <span className="truncate text-xs text-muted-foreground">{[comment.jira?.key, comment.element?.selector, comment.page?.url].filter(Boolean).join('  ')}</span>
        {comment.rect && <RegionThumb comment={comment} number={number} disabled={draft.remove} />}
      </div>
      {draft.remove ? (
        <Button size="sm" variant="outline" onClick={() => set({ remove: false })} aria-label={`Keep comment ${label}`}>
          <RotateCcw />
          Restore
        </Button>
      ) : (
        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => set({ remove: true })} aria-label={`Delete comment ${label}`} title={`Delete comment ${label}`}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

/**
 * Every comment of the review in one form. Starts from the stored comments each time it opens.
 * @param props.onDirty Reports how many rows have changes, so closing can ask first.
 */
function EditForm({ onDirty }: { onDirty: (count: number) => void }) {
  const { ordered, numberOf } = useReportComments();
  const [drafts, setDrafts] = useState(() => new Map(ordered.map((comment) => [comment.id, draftOf(comment)])));
  const [linkErrors, setLinkErrors] = useState<Map<string, string[]>>(new Map());
  const [saving, setSaving] = useState(false);
  const rows = ordered.flatMap((comment) => {
    const draft = drafts.get(comment.id);
    return draft ? [{ comment, draft }] : [];
  });
  const removing = rows.filter((row) => row.draft.remove).length;

  const update = (id: string, draft: Draft) => {
    const next = new Map(drafts).set(id, draft);
    setDrafts(next);
    onDirty(rows.filter((row) => changed(row.comment, next.get(row.comment.id) ?? row.draft)).length);
  };

  const save = async () => {
    const errors = new Map(
      rows.flatMap(({ comment, draft }) => {
        const { bad } = parseLinks(draft.links);
        return !draft.remove && bad.length ? [[comment.id, bad] as const] : [];
      }),
    );
    setLinkErrors(errors);
    const [firstBad] = errors.keys();
    if (firstBad) {
      document.querySelector<HTMLInputElement>(`[data-edit-row="${firstBad}"] input[aria-invalid]`)?.focus();
      return;
    }
    setSaving(true);
    let updated = 0;
    let deleted = 0;
    try {
      for (const { comment, draft } of rows) {
        if (draft.remove) {
          await ask('discard', { id: comment.id });
          deleted += 1;
        } else if (changed(comment, draft)) {
          const { links } = parseLinks(draft.links);
          await ask('update', { id: comment.id, patch: { severity: draft.severity, status: draft.status, title: draft.title.trim(), note: draft.note.trim(), links } });
          updated += 1;
        }
      }
      onDirty(0);
      closeDialog();
      const parts = [updated && plural(updated, 'comment updated', 'comments updated'), deleted && `${deleted} deleted`].filter(Boolean);
      toast.success(parts.length ? `Saved. ${parts.join(', ')}.` : 'No changes to save');
    } catch (error) {
      toast.error(`Saving stopped. ${error instanceof Error ? error.message : String(error)}`);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="-mx-4 min-h-0 overflow-y-auto px-4">
        {rows.map(({ comment, draft }) => (
          <EditRow
            key={comment.id}
            comment={comment}
            number={numberOf(comment)}
            draft={draft}
            linkError={linkErrors.get(comment.id)}
            onChange={(next) => update(comment.id, next)}
          />
        ))}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto text-xs text-muted-foreground">Image edits save from the image editor.</span>
        <Button variant="outline" onClick={() => requestClose()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving' : removing ? `Save and delete ${removing}` : 'Save changes'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** How many rows of the open form have unsaved changes. */
const useDirtyRows = create(() => 0);

/** Closes Edit comments, asking first when something changed. */
async function requestClose() {
  const dirtyRows = useDirtyRows.getState();
  if (dirtyRows) {
    const choice = await confirm({
      title: `Discard changes to ${plural(dirtyRows, 'comment', 'comments')}?`,
      body: 'The edits you made here have not been saved.',
      choices: [
        { label: 'Keep editing', value: null },
        { label: 'Discard changes', value: 'discard', variant: 'destructive' },
      ],
    });
    if (choice !== 'discard') return;
  }
  useDirtyRows.setState(0, true);
  closeDialog();
}

/** Edit comments: severity, status, title, note and links of every comment, and deleting comments, saved together. */
export function EditCommentsDialog() {
  const open = useReportUi((state) => state.dialog === 'edit');
  const { all } = useReportComments();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit comments</DialogTitle>
          <DialogDescription>{plural(all.length, 'comment', 'comments')}. Edits apply to the report and exports.</DialogDescription>
        </DialogHeader>
        {open && <EditForm onDirty={(count) => useDirtyRows.setState(count, true)} />}
      </DialogContent>
    </Dialog>
  );
}
