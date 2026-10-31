import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { useConnection } from '../queries';
import type { FigmaLink, Group, JiraLink } from '../types';
import { BAD, LINKED, LinkField, initialLink, type Kind, type LinkState } from './link-field';

export type SheetMode = { mode: 'new' | 'edit'; focus: 'name' | Kind };
export type SheetResult = { name: string; jira: JiraLink | null; figma: FigmaLink | null };

type Props = {
  sheet: SheetMode | null;
  group: Group | null;
  /** The name a new review starts with. */
  newName: string;
  onClose: () => void;
  onSubmit: (result: SheetResult) => Promise<void>;
};

/** Starts a review, or changes this one's name and its Jira ticket and Figma file. Both links are optional. */
export function ReviewSheetDialog({ sheet, group, newName, onClose, onSubmit }: Props) {
  return (
    <Dialog open={Boolean(sheet)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{sheet && <Sheet sheet={sheet} group={sheet.mode === 'edit' ? group : null} newName={newName} onSubmit={onSubmit} />}</DialogContent>
    </Dialog>
  );
}

/** The form, mounted each time the dialog opens, so it starts from the review as it is. */
function Sheet({ sheet, group, newName, onSubmit }: { sheet: SheetMode; group: Group | null; newName: string; onSubmit: Props['onSubmit'] }) {
  const editing = sheet.mode === 'edit';
  const [name, setName] = useState(group?.name ?? newName);
  const [links, setLinks] = useState<Record<Kind, LinkState>>({ jira: initialLink('jira', group?.jira), figma: initialLink('figma', group?.figma) });
  const jiraConnection = useConnection<{ sites?: unknown[] }>('jira');
  const figmaConnection = useConnection('figma');
  const connected = { jira: Boolean(jiraConnection.data?.sites?.length), figma: Boolean(figmaConnection.data) };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<Record<Kind, Promise<void> | null>>({ jira: null, figma: null });
  const latest = useRef(links);
  latest.current = links;
  const nameInput = useRef<HTMLInputElement>(null);

  const setLink = (kind: Kind) => (state: LinkState) => setLinks((all) => ({ ...all, [kind]: state }));

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the review a name');
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    // A link field looks up what was typed when it loses focus, a moment later, so wait for that to start.
    await new Promise((done) => setTimeout(done, 200));
    await Promise.all(Object.values(pending.current));
    const wrong = (['jira', 'figma'] as const).find((kind) => BAD.has(latest.current[kind].status) || (latest.current[kind].status === 'input' && latest.current[kind].text.trim()));
    if (wrong) {
      setError(`Fix or clear the ${wrong === 'jira' ? 'Jira ticket' : 'Figma file'} to ${editing ? 'save' : 'start'}`);
      setBusy(false);
      return;
    }
    const linkOf = (kind: Kind) => (LINKED.has(latest.current[kind].status) ? latest.current[kind].value : null);
    try {
      await onSubmit({ name: trimmed, jira: linkOf('jira') as JiraLink | null, figma: linkOf('figma') as FigmaLink | null });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit review' : 'New review'}</DialogTitle>
        <DialogDescription>{editing ? 'Change the name and the links that go with it.' : 'New comments from the page go to this review.'}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="review-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          ref={nameInput}
          id="review-name"
          autoComplete="off"
          maxLength={120}
          value={name}
          autoFocus={sheet.focus === 'name'}
          onFocus={(e) => !editing && e.target.select()}
          aria-invalid={error === 'Give the review a name' || undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
        />
      </div>
      {(['jira', 'figma'] as const).map((kind) => (
          <LinkField
            key={kind}
            kind={kind}
            state={links[kind]}
            onChange={setLink(kind)}
            connected={connected[kind]}
            onPending={(p) => (pending.current[kind] = p)}
            autoFocus={sheet.focus === kind}
          />
        ))}
      <DialogFooter className="items-center">
        <p role="status" className="mr-auto text-sm text-destructive">
          {error}
        </p>
        <span className="hidden items-center gap-1.5 text-sm font-medium text-muted-foreground sm:flex">
          <Kbd>Enter</Kbd>
        </span>
        <Button type="submit" disabled={busy}>
          {editing ? 'Save review' : 'Start review'}
        </Button>
      </DialogFooter>
    </form>
  );
}
