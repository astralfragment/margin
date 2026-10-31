import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { PenLine, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SeverityLabel } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { SEVERITIES, severityOf } from '@/lib/severity.js';
import { STATUSES, statusOf } from '@/lib/status.js';
import { cn } from '@/lib/utils';
import { useConfirm } from './confirm';
import { ImageEditor } from './editor/image-editor';
import { patchCached } from './queries';
import type { Issue } from './types';
import { pad, parseLinks, plural, send } from './util';

type Draft = { severity: string; status: string; title: string; note: string; links: string; remove: boolean };

const draftOf = (issue: Issue): Draft => ({
  severity: severityOf(issue.severity).key,
  status: statusOf(issue.status).key,
  title: issue.title ?? '',
  note: issue.note ?? '',
  links: (issue.links ?? []).join(' '),
  remove: false,
});

const same = (a?: Draft, b?: Draft) => JSON.stringify(a) === JSON.stringify(b);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ordered: Issue[];
  numberOf: (issue: Issue) => number;
};

/** Every comment's severity, status, title, note and links in one place, saved together. */
export function EditCommentsDialog({ open, onOpenChange, ordered, numberOf }: Props) {
  const form = useRef<{ requestClose: () => void }>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : form.current?.requestClose())}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-3xl">
        <EditForm ref={form} ordered={ordered} numberOf={numberOf} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type FormProps = Pick<Props, 'ordered' | 'numberOf'> & { onClose: () => void; ref: Ref<{ requestClose: () => void }> };

/** The rows, mounted each time the dialog opens, so the drafts start from the comments as they are. */
function EditForm({ ordered, numberOf, onClose, ref }: FormProps) {
  const confirm = useConfirm();
  const [initial] = useState<Record<string, Draft>>(() => Object.fromEntries(ordered.map((issue) => [issue.id, draftOf(issue)])));
  const [drafts, setDrafts] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = ordered.find((issue) => issue.id === editingId) ?? null;

  const dirty = useMemo(() => Object.keys(drafts).filter((id) => initial[id] && !same(drafts[id], initial[id])).length, [drafts, initial]);
  const removing = Object.values(drafts).filter((d) => d.remove).length;
  const set = (id: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id]!, ...patch } }));

  const requestClose = async () => {
    if (dirty) {
      const choice = await confirm({
        title: `Discard changes to ${plural(dirty, 'comment', 'comments')}?`,
        body: 'The edits you made here have not been saved.',
        buttons: [
          { label: 'Keep editing', value: null },
          { label: 'Discard changes', value: 'discard', kind: 'destructive' },
        ],
      });
      if (choice !== 'discard') return;
    }
    onClose();
  };
  useImperativeHandle(ref, () => ({ requestClose }));

  const save = async () => {
    const bad: Record<string, string> = {};
    for (const issue of ordered) {
      const d = drafts[issue.id];
      if (!d) continue;
      const { bad: parts } = parseLinks(d.links);
      if (parts.length && !d.remove) bad[issue.id] = `${parts.join(' and ')} ${parts.length === 1 ? 'is not a link' : 'are not links'}. Paste the full address, starting with https://`;
    }
    setErrors(bad);
    const first = ordered.find((issue) => bad[issue.id]);
    if (first) {
      document.getElementById(`links-${first.id}`)?.focus();
      return;
    }
    setSaving(true);
    let changed = 0;
    let removed = 0;
    for (const issue of ordered) {
      const d = drafts[issue.id];
      if (!d) continue;
      if (d.remove) {
        await send('discard', { id: issue.id });
        removed += 1;
        continue;
      }
      if (same(d, initial[issue.id])) continue;
      const patch = { severity: d.severity, status: d.status, title: d.title.trim(), note: d.note.trim(), links: parseLinks(d.links).links };
      await send('update', { id: issue.id, patch });
      changed += 1;
    }
    onClose();
    const parts = [changed && plural(changed, 'comment updated', 'comments updated'), removed && `${removed} deleted`].filter(Boolean);
    toast.success(parts.length ? `Saved. ${parts.join(', ')}.` : 'No changes to save');
  };

  return (
    <>
      <DialogHeader className="flex-row items-baseline justify-between border-b p-5">
        <DialogTitle>Edit comments</DialogTitle>
        <DialogDescription>{plural(ordered.length, 'comment', 'comments')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-0 overflow-y-auto">
        {ordered.map((issue) => {
          const d = drafts[issue.id];
          if (!d) return null;
          const n = pad(numberOf(issue));
          return (
            <section
              key={issue.id}
              aria-label={`Comment ${n}`}
              className={cn('grid grid-cols-[24px_minmax(0,1fr)_32px] gap-x-3 gap-y-3 border-b px-5 py-4 last:border-b-0', d.remove && 'bg-muted/50')}
            >
              <span className="pt-1.5 text-xs font-medium text-muted-foreground tabular-nums">{n}</span>
              <fieldset disabled={d.remove} className={cn('grid min-w-0 gap-3', d.remove && 'opacity-50')}>
                <div className="flex flex-wrap gap-2">
                  <Select value={d.severity} onValueChange={(v) => v && set(issue.id, { severity: v })}>
                    <SelectTrigger size="sm" aria-label={`Severity of comment ${n}`} className="min-w-32">
                      <SelectValue>{(v: string) => <SeverityLabel severity={v} className="text-sm" />}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s: { key: string }) => (
                        <SelectItem key={s.key} value={s.key}>
                          <SeverityLabel severity={s.key} className="text-sm" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={d.status} onValueChange={(v) => v && set(issue.id, { status: v })}>
                    <SelectTrigger size="sm" aria-label={`Status of comment ${n}`} className="min-w-32">
                      <SelectValue>{(v: string) => <StatusLabel status={v} className="text-sm" />}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s: { key: string }) => (
                        <SelectItem key={s.key} value={s.key}>
                          <StatusLabel status={s.key} className="text-sm" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input value={d.title} onChange={(e) => set(issue.id, { title: e.target.value })} placeholder="What is wrong" aria-label={`Title of comment ${n}`} className="font-semibold" />
                <Textarea value={d.note} onChange={(e) => set(issue.id, { note: e.target.value })} rows={2} placeholder="Expected, actual, steps" aria-label={`Note of comment ${n}`} className="min-h-16" />
                <div className="grid gap-1.5">
                  <Input
                    id={`links-${issue.id}`}
                    value={d.links}
                    onChange={(e) => set(issue.id, { links: e.target.value })}
                    placeholder="Links, such as a Figma frame, optional"
                    aria-label={`Links of comment ${n}`}
                    aria-invalid={Boolean(errors[issue.id]) || undefined}
                    aria-describedby={errors[issue.id] ? `links-error-${issue.id}` : undefined}
                  />
                  {errors[issue.id] && (
                    <p id={`links-error-${issue.id}`} className="text-sm text-destructive">
                      {errors[issue.id]}
                    </p>
                  )}
                </div>
                <p className="flex min-w-0 gap-3 text-sm font-medium text-muted-foreground">
                {[issue.jira?.key, issue.element?.selector, issue.page?.url].filter(Boolean).map((part) => (
                  <span key={part} className="truncate">
                    {part}
                  </span>
                ))}
              </p>
                {issue.shot && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingId(issue.id)}
                      className="overflow-hidden rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`Annotate the screenshot of comment ${n}`}
                    >
                      <img src={issue.detail ?? ''} alt="" className="block h-14 w-auto max-w-40 object-cover" />
                    </button>
                    <div className="grid gap-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        {issue.marks?.length ? plural(issue.marks.length, 'numbered annotation', 'numbered annotations') : 'No annotations yet'}
                      </span>
                      <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditingId(issue.id)}>
                        <PenLine />
                        Annotate
                      </Button>
                    </div>
                  </div>
                )}
              </fieldset>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={d.remove ? `Keep comment ${n}` : `Delete comment ${n}`}
                title={d.remove ? `Keep comment ${n}` : `Delete comment ${n}`}
                onClick={() => set(issue.id, { remove: !d.remove })}
                className={d.remove ? undefined : 'text-muted-foreground hover:text-destructive'}
              >
                {d.remove ? <RotateCcw /> : <Trash2 />}
              </Button>
            </section>
          );
        })}
      </div>
      <DialogFooter className="m-0 items-center rounded-b-xl">
        <p className="mr-auto text-sm font-medium text-muted-foreground">Image edits save from the image editor.</p>
        <Button variant="outline" onClick={requestClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving} variant={removing ? 'destructive' : 'default'}>
          {saving ? 'Saving' : removing ? `Save and delete ${removing}` : 'Save changes'}
        </Button>
      </DialogFooter>
      <ImageEditor
        modal
        issue={editing}
        label={editing ? `Annotate comment ${pad(numberOf(editing))}` : ''}
        onSaved={patchCached}
        onClosed={() => setEditingId(null)}
      />
    </>
  );
}
