import { useId, useState } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import { CircleCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SEVERITIES, severityOf, STATUSES, statusOf } from './shared';
import type { Comment, CommentStatus, Severity } from '@/lib/model';
import { ask } from './data';
import { confirm } from './confirm';
import { useReportUi } from './ui-store';
import { useReportComments } from './use-report';
import { pad, plural } from './format';
import { SeverityDot, STATUS_ICONS } from './badges';

/**
 * Comments are edited where they sit in the report, one at a time, and selected with a checkbox to delete or close
 * several at once.
 */

interface Draft {
  severity: Severity;
  status: CommentStatus;
  title: string;
  note: string;
  links: string;
}

interface EditState {
  /** The comment open for editing. */
  editingId: string | null;
  /** True when the open editor has changes that are not saved. */
  dirty: boolean;
  /** The comments selected for a bulk action. */
  selected: string[];
}

export const useCommentEdit = create<EditState>(() => ({ editingId: null, dirty: false, selected: [] }));

useReportUi.subscribe((state, previous) => {
  if (state.reviewKey !== previous.reviewKey) useCommentEdit.setState({ editingId: null, dirty: false, selected: [] });
});

const SEVERITY_PRESSED: Record<Severity, string> = {
  blocker: 'hover:bg-blocker-tint aria-pressed:border-blocker aria-pressed:bg-blocker-tint aria-pressed:text-blocker',
  major: 'hover:bg-major-tint aria-pressed:border-major aria-pressed:bg-major-tint aria-pressed:text-major',
  minor: 'hover:bg-minor-tint aria-pressed:border-minor aria-pressed:bg-minor-tint aria-pressed:text-minor',
  nit: 'hover:bg-nit-tint aria-pressed:border-nit aria-pressed:bg-nit-tint aria-pressed:text-nit',
};

const STATUS_PRESSED: Record<CommentStatus, string> = {
  open: 'aria-pressed:border-foreground/40 aria-pressed:bg-muted',
  fixed: 'hover:bg-fixed-tint aria-pressed:border-fixed aria-pressed:bg-fixed-tint aria-pressed:text-fixed',
  wontfix: 'aria-pressed:border-foreground/40 aria-pressed:bg-muted aria-pressed:text-muted-foreground',
};

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
 * A comment's fields as the editor starts with them.
 * @param comment The stored comment.
 */
const draftOf = (comment: Comment): Draft => ({
  severity: severityOf(comment.severity).key,
  status: statusOf(comment.status).key,
  title: comment.title ?? '',
  note: comment.note ?? '',
  links: (comment.links ?? []).join(' '),
});

/**
 * True when the editor's values differ from the stored comment.
 * @param comment The stored comment.
 * @param draft The editor's values.
 */
const changed = (comment: Comment, draft: Draft) => JSON.stringify(draftOf(comment)) !== JSON.stringify(draft);

/** Asks before unsaved edits are thrown away, and says whether to go ahead. */
async function mayLeaveEditor() {
  if (!useCommentEdit.getState().dirty) return true;
  const choice = await confirm({
    title: 'Discard your changes?',
    body: 'The edits to this comment have not been saved.',
    choices: [
      { label: 'Keep editing', value: null },
      { label: 'Discard changes', value: 'discard', variant: 'destructive' },
    ],
  });
  return choice === 'discard';
}

/**
 * Opens a comment for editing in place, asking first when another one has unsaved changes.
 * @param id The comment id.
 */
export async function startEditing(id: string) {
  const { editingId } = useCommentEdit.getState();
  if (editingId === id || !(await mayLeaveEditor())) return;
  useCommentEdit.setState({ editingId: id, dirty: false });
}

/** Closes the editor, asking first when it has unsaved changes. */
async function cancelEditing() {
  if (await mayLeaveEditor()) useCommentEdit.setState({ editingId: null, dirty: false });
}

/**
 * Selects or clears a comment for a bulk action.
 * @param id The comment id.
 * @param on Whether it is selected.
 */
export function setSelected(id: string, on: boolean) {
  const { selected } = useCommentEdit.getState();
  useCommentEdit.setState({ selected: on ? [...new Set([...selected, id])] : selected.filter((entry) => entry !== id) });
}

/** The selected comments that are still in the review shown, so deleted ones drop out on their own. */
export function useSelectedIds() {
  const { all } = useReportComments();
  const selected = useCommentEdit((state) => state.selected);
  return selected.filter((id) => all.some((comment) => comment.id === id));
}

/**
 * Deletes comments with their screenshots after asking.
 * @param comments The comments.
 * @param numberOf Their numbers, for the question.
 */
async function deleteComments(comments: Comment[], numberOf: (comment: Comment) => number) {
  const one = comments.length === 1;
  const choice = await confirm({
    title: one ? `Delete comment ${pad(numberOf(comments[0]!))}?` : `Delete ${comments.length} comments?`,
    body: `This deletes ${one ? 'the comment and its screenshots' : 'them with their screenshots'}. Save a review file first to keep a copy.`,
    choices: [
      { label: 'Cancel', value: null },
      { label: one ? 'Delete comment' : `Delete ${comments.length} comments`, value: 'delete', variant: 'destructive' },
    ],
  });
  if (choice !== 'delete') return;
  let deleted = 0;
  try {
    for (const comment of comments) {
      await ask('discard', { id: comment.id });
      deleted += 1;
    }
    const ids = new Set(comments.map((comment) => comment.id));
    const { editingId, selected } = useCommentEdit.getState();
    useCommentEdit.setState({
      selected: selected.filter((id) => !ids.has(id)),
      ...(editingId && ids.has(editingId) ? { editingId: null, dirty: false } : {}),
    });
    toast.success(`Deleted ${plural(deleted, 'comment', 'comments')}`);
  } catch (error) {
    toast.error(`Deleted ${deleted} of ${comments.length}, then it stopped. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sets the status of several comments at once.
 * @param comments The comments.
 * @param status The new status.
 */
async function setStatusOf(comments: Comment[], status: CommentStatus) {
  try {
    for (const comment of comments) await ask('update', { id: comment.id, patch: { status } });
    useCommentEdit.setState({ selected: [] });
    toast.success(`Marked ${plural(comments.length, 'comment', 'comments')} as ${statusOf(status).label.toLowerCase()}`);
  } catch (error) {
    toast.error(`The status was not changed. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The checkbox that selects every comment the filters leave, or clears them.
 * @param props.className Placement from the caller.
 */
export function SelectAllShown({ className }: { className?: string }) {
  const { shown } = useReportComments();
  const selected = useSelectedIds();
  const shownSelected = shown.filter((comment) => selected.includes(comment.id)).length;
  const every = shown.length > 0 && shownSelected === shown.length;
  return (
    <Checkbox
      className={className}
      aria-label={every ? 'Clear the selection' : 'Select every comment shown'}
      checked={every}
      indeterminate={shownSelected > 0 && !every}
      disabled={!shown.length}
      onCheckedChange={() =>
        useCommentEdit.setState({
          selected: every ? selected.filter((id) => !shown.some((comment) => comment.id === id)) : [...new Set([...selected, ...shown.map((comment) => comment.id)])],
        })
      }
    />
  );
}

/** The bar over the comments while some are selected: how many, and what can be done to all of them. */
export function BulkBar() {
  const { all, numberOf } = useReportComments();
  const selected = useSelectedIds();
  if (!selected.length) return null;
  const picked = all.filter((comment) => selected.includes(comment.id));
  const allFixed = picked.every((comment) => statusOf(comment.status).key === 'fixed');
  return (
    <div role="toolbar" aria-label="Selected comments" className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 md:-mx-8 md:px-8">
      <SelectAllShown className="mr-1" />
      <span className="text-sm font-semibold">{selected.length} selected</span>
      <Button variant="ghost" size="sm" onClick={() => useCommentEdit.setState({ selected: [] })}>
        Clear
      </Button>
      <span className="flex-1" />
      <Button variant="outline" size="sm" onClick={() => setStatusOf(picked, allFixed ? 'open' : 'fixed')}>
        <CircleCheck />
        {allFixed ? 'Mark open' : 'Mark fixed'}
      </Button>
      <Button variant="destructive" size="sm" onClick={() => deleteComments(picked, numberOf)}>
        <Trash2 />
        Delete {selected.length}
      </Button>
    </div>
  );
}

/**
 * A comment's fields, edited where the comment sits in the report. Ctrl or Cmd with Enter saves, Escape cancels.
 * @param props.comment The stored comment.
 * @param props.number Its number.
 */
export function CommentEditor({ comment, number }: { comment: Comment; number: number }) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(comment));
  const [linkError, setLinkError] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const label = pad(number);

  const set = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    useCommentEdit.setState({ dirty: changed(comment, next) });
  };

  const save = async () => {
    const { links, bad } = parseLinks(draft.links);
    setLinkError(bad.length ? bad : null);
    if (bad.length) {
      document.getElementById(`${id}-links`)?.focus();
      return;
    }
    if (!changed(comment, draft)) {
      useCommentEdit.setState({ editingId: null, dirty: false });
      return;
    }
    setSaving(true);
    try {
      await ask('update', {
        id: comment.id,
        patch: { severity: draft.severity, status: draft.status, title: draft.title.trim(), note: draft.note.trim(), links },
      });
      useCommentEdit.setState({ editingId: null, dirty: false });
      toast.success(`Saved comment ${label}`);
    } catch (error) {
      toast.error(`The comment was not saved. ${error instanceof Error ? error.message : String(error)}`);
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={`Edit comment ${label}`}
      className="mt-3 flex max-w-[68ch] flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelEditing();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save();
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
        <Input id={`${id}-title`} autoFocus value={draft.title} placeholder="What is wrong" onChange={(event) => set({ title: event.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <Field className="w-auto">
          <FieldLabel id={`${id}-severity`}>Severity</FieldLabel>
          <ToggleGroup
            aria-labelledby={`${id}-severity`}
            value={[draft.severity]}
            onValueChange={(next) => next[0] && set({ severity: next[0] as Severity })}
            variant="outline"
            size="sm"
            spacing={1}
          >
            {SEVERITIES.map((sev) => (
              <ToggleGroupItem key={sev.key} value={sev.key} className={SEVERITY_PRESSED[sev.key]}>
                <SeverityDot severity={sev.key} />
                {sev.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field className="w-auto">
          <FieldLabel id={`${id}-status`}>Status</FieldLabel>
          <ToggleGroup
            aria-labelledby={`${id}-status`}
            value={[draft.status]}
            onValueChange={(next) => next[0] && set({ status: next[0] as CommentStatus })}
            variant="outline"
            size="sm"
            spacing={1}
          >
            {STATUSES.map((entry) => {
              const Icon = STATUS_ICONS[entry.key];
              return (
                <ToggleGroupItem key={entry.key} value={entry.key} className={STATUS_PRESSED[entry.key]}>
                  <Icon />
                  {entry.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
        <Textarea id={`${id}-note`} value={draft.note} placeholder="What you expected, what you saw, and how to get there" className="min-h-20" onChange={(event) => set({ note: event.target.value })} />
      </Field>
      <Field data-invalid={linkError ? true : undefined}>
        <FieldLabel htmlFor={`${id}-links`}>Links</FieldLabel>
        <Input
          id={`${id}-links`}
          value={draft.links}
          aria-invalid={linkError ? true : undefined}
          placeholder="https://figma.com/design/..."
          onChange={(event) => {
            setLinkError(null);
            set({ links: event.target.value });
          }}
        />
        {linkError ? (
          <FieldError>
            {linkError.join(' and ')} {linkError.length === 1 ? 'is not a link' : 'are not links'}. Paste the full address, starting with https://
          </FieldError>
        ) : (
          <FieldDescription>Optional. Figma frames, tickets or pages, separated by spaces.</FieldDescription>
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => deleteComments([comment], () => number)}>
          <Trash2 />
          Delete comment
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="outline" onClick={cancelEditing}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
