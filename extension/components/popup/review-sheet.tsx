import { useRef, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { dropDraft, saveDraft, type Draft, type SheetMode } from './draft';
import { IconButton } from './icon-button';
import { LinkField } from './link-field';
import type { Group, Link, LinkKind } from './model';
import { Panel } from './panel';
import { BAD, LINKED, fieldFor, linkText, useLinkField, type FieldState } from './use-link-field';

const NAME_MAX = 120;

export type SheetResult = { name: string; jira: Link | null; figma: Link | null };

type Props = {
  mode: SheetMode;
  focus: 'name' | LinkKind;
  group: Group | null;
  defaultName: string;
  /** What was typed here before the popup closed, to pick up from. */
  draft: Draft | null;
  draftScope: string;
  connected: Record<LinkKind, boolean>;
  onClose: () => void;
  onSubmit: (result: SheetResult) => Promise<void>;
};

/**
 * Starts a review with a name and optional Jira and Figma links, or edits the open one. What is typed is kept as a
 * draft for this tab, so leaving the popup to copy a link never loses it.
 */
export function ReviewSheet({ mode, focus, group, defaultName, draft, draftScope, connected, onClose, onSubmit }: Props) {
  const editing = mode === 'edit';
  const kept = draft && draft.mode === mode && draft.groupId === (group?.id ?? null) ? draft : null;
  const [name, setName] = useState(kept?.name ?? group?.name ?? defaultName);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = useRef({ name, jira: kept?.fields?.jira ?? fieldFor('jira', group?.jira), figma: kept?.fields?.figma ?? fieldFor('figma', group?.figma) });
  const nameInput = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const selected = useRef(false);

  /** Keeps what the sheet holds, so it comes back after the popup closes. */
  const persist = (change: Partial<{ name: string; jira: FieldState; figma: FieldState }>) => {
    const next = Object.assign(latest.current, change);
    saveDraft({
      mode,
      scope: draftScope,
      groupId: group?.id ?? null,
      name: next.name,
      jira: linkText('jira', next.jira),
      figma: linkText('figma', next.figma),
      fields: { jira: next.jira, figma: next.figma },
    });
  };

  const jira = useLinkField('jira', latest.current.jira, connected.jira, (field) => persist({ jira: field }));
  const figma = useLinkField('figma', latest.current.figma, connected.figma, (field) => persist({ figma: field }));

  const close = async () => {
    await dropDraft();
    onClose();
  };

  const connect = (kind: LinkKind) => {
    browser.tabs.create({ url: browser.runtime.getURL(`/options.html#connect-${kind}`) });
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Give the review a name');
      nameInput.current?.focus();
      return;
    }
    setSaving(true);
    setProblem('');
    const [j, f] = await Promise.all([jira.settle(), figma.settle()]);
    const wrong = BAD.has(j.status) ? 'jira' : BAD.has(f.status) ? 'figma' : null;
    if (wrong) {
      setProblem(`Fix or clear the ${wrong === 'jira' ? 'Jira ticket' : 'Figma file'} to ${editing ? 'save' : 'start'}`);
      setSaving(false);
      form.current?.querySelector<HTMLElement>(`[data-field="${wrong}"] input`)?.focus();
      return;
    }
    await dropDraft();
    try {
      await onSubmit({ name: trimmed, jira: LINKED.has(j.status) ? j.value : null, figma: LINKED.has(f.status) ? f.value : null });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Panel
      title={editing ? 'Edit review' : 'New review'}
      onEscape={close}
      back={
        <IconButton label="Close" onClick={close}>
          <X />
        </IconButton>
      }
      footer={
        <div className="flex items-center gap-2">
          <span role="status" className="min-w-0 flex-1 text-xs font-semibold text-destructive">
            {problem}
          </span>
          <Kbd>Enter</Kbd>
          <Button ref={submit} type="submit" form="review-sheet" disabled={saving} className="h-9 px-4">
            {editing ? 'Save review' : 'Start review'}
          </Button>
        </div>
      }
    >
      <form id="review-sheet" ref={form} noValidate onSubmit={send} className="grid gap-6">
        <div className="grid gap-2">
          <label htmlFor="sheet-name" className="text-sm font-semibold">
            Name
          </label>
          <Input
            id="sheet-name"
            ref={nameInput}
            autoFocus={focus === 'name'}
            autoComplete="off"
            maxLength={NAME_MAX}
            value={name}
            aria-invalid={problem === 'Give the review a name' || undefined}
            className="h-9 text-sm"
            onFocus={(event) => {
              if (selected.current || editing) return;
              selected.current = true;
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setName(event.target.value);
              setProblem('');
              persist({ name: event.target.value });
            }}
          />
        </div>
        <div data-field="jira">
          <LinkField
            api={jira}
            autoFocus={focus === 'jira'}
            onConnect={connect}
            focusNext={() => (form.current?.querySelector<HTMLElement>('[data-field="figma"] input') ?? submit.current)?.focus()}
          />
        </div>
        <div data-field="figma">
          <LinkField api={figma} autoFocus={focus === 'figma'} onConnect={connect} focusNext={() => submit.current?.focus()} />
        </div>
      </form>
    </Panel>
  );
}
