import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  frameCount,
  lookUpFigma,
  lookUpJira,
  parseFigmaInput,
  parseJiraInput,
  recentFigmaFiles,
  recentJiraIssues,
  rememberFigmaFile,
  statusTone,
  cleanFigmaLink,
  cleanJiraLink,
  type LinkValue,
} from './shared';
import { cn } from '@/lib/utils';
import type { Review } from '@/lib/model';
import { ask, connectionQuery } from './data';
import { FigmaIcon, JiraIcon } from './brand-icons';
import { jiraToneClass } from './badges';
import { closeDialog, showReview, useReportUi } from './ui-store';
import { useReviews } from './use-report';

/**
 * The New review sheet, also used to edit a review's name and links. Both links are optional. A pasted Jira key or
 * Figma link is looked up when the service is connected, and kept as typed when it is not.
 */

type Kind = 'jira' | 'figma';
type Status = 'input' | 'invalid' | 'notFound' | 'error' | 'looking' | 'ok' | 'notConnected' | 'noAccess' | 'otherSite' | 'removed';

interface LinkState {
  status: Status;
  text: string;
  value: LinkValue | null;
  site: string;
  message: string;
  token: number;
  previous?: LinkState;
}

const LINKED = new Set<Status>(['ok', 'notConnected', 'noAccess', 'otherSite']);
const TYPED = new Set<Status>(['input', 'invalid', 'notFound', 'error']);
const BAD = new Set<Status>(['invalid', 'notFound', 'error']);
const UNDO_MS = 5000;

const COPY = {
  jira: {
    label: 'Jira ticket',
    placeholder: 'Paste a key like SS-112 or a Jira link',
    invalid: 'That is not a Jira key or link. Paste a key like SS-112 or the link to the issue.',
    notFound: (value: LinkValue) => `No ticket ${value.key} in your Jira sites. Check the key, it stays here to fix.`,
    noAccess: (value: LinkValue) => `You do not have access to ${value.key}`,
    otherSite: (site: string) => `${site} is not one of your connected Jira sites.`,
    looking: (value: LinkValue) => `Looking up ${value.key}`,
    removed: (value: LinkValue) => `${value.key} removed`,
    title: (value: LinkValue) => value.key ?? '',
    preview: (text: string) => {
      const parsed = parseJiraInput(text);
      return parsed && { key: parsed.key };
    },
  },
  figma: {
    label: 'Figma file',
    placeholder: 'Paste a Figma file link',
    invalid: 'That is not a Figma file link. In Figma, choose Share and then Copy link.',
    notFound: () => 'No Figma file at that link. Check the link, it stays here to fix.',
    noAccess: () => 'You do not have access to this Figma file. Connecting Figma again in Help and settings may fix it.',
    otherSite: () => '',
    looking: (value: LinkValue) => `Looking up ${value.name || 'the Figma file'}`,
    removed: (value: LinkValue) => `${value.name || 'Figma file'} removed`,
    title: (value: LinkValue) => value.name || 'Figma file',
    preview: (text: string) => parseFigmaInput(text),
  },
};

/**
 * A link field's state when the sheet opens.
 * @param value The link the review already has.
 * @param kind Which service.
 */
function initialState(value: LinkValue | null | undefined, kind: Kind): LinkState {
  const known = value && (kind === 'jira' ? value.summary || value.status : value.frames?.length);
  return { status: value ? (known ? 'ok' : 'notConnected') : 'input', text: '', value: value ?? null, site: '', message: '', token: 0 };
}

/**
 * Looks up what was typed in a link field and returns the field's next state.
 * @param kind Which service.
 * @param text What was typed or pasted.
 * @param token The lookup's number, so an older answer never replaces a newer one.
 */
async function resolveLink(kind: Kind, text: string, token: number): Promise<LinkState> {
  const base = { text, site: '', message: '', token, value: null };
  if (!text.trim()) return { ...base, status: 'input' };
  if (!COPY[kind].preview(text)) return { ...base, status: 'invalid' };
  const reply = kind === 'jira' ? await lookUpJira(text) : await lookUpFigma(text);
  const value = (reply.jira ?? reply.figma ?? COPY[kind].preview(text)) as LinkValue;
  if (kind === 'figma' && LINKED.has(reply.state)) await rememberFigmaFile(value);
  return { ...base, status: reply.state as Status, value, site: reply.site ?? '', message: reply.message ?? '' };
}

/**
 * The error under a link input, or an empty string.
 * @param kind Which service.
 * @param state The field state.
 */
function errorText(kind: Kind, state: LinkState) {
  if (state.status === 'invalid') return COPY[kind].invalid;
  if (state.status === 'notFound') return COPY[kind].notFound(state.value ?? {});
  if (state.status === 'error') return `Could not look this up. ${state.message}`;
  return '';
}

/**
 * The input of a link field, with recent tickets or files to pick from when the service is connected.
 * @param props.kind Which service.
 * @param props.state The field state.
 * @param props.onType Called as the text changes.
 * @param props.onResolve Called with text to look up.
 */
function LinkInput({ kind, state, onType, onResolve }: { kind: Kind; state: LinkState; onType: (text: string) => void; onResolve: (text: string) => void }) {
  const connected = useQuery(connectionQuery(kind)).data;
  const live = kind === 'jira' ? Boolean(connected?.sites?.length) : Boolean(connected);
  const suggestions = useQuery({
    queryKey: ['suggest', kind],
    enabled: live,
    queryFn: async (): Promise<LinkValue[]> => (kind === 'jira' ? recentJiraIssues() : recentFigmaFiles()),
  }).data;
  const bad = BAD.has(state.status);
  const common = {
    id: `review-${kind}`,
    placeholder: COPY[kind].placeholder,
    autoComplete: 'off',
    spellCheck: false,
    'aria-invalid': bad || undefined,
    onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData('text');
      if (text.trim()) {
        event.preventDefault();
        onResolve(text);
      }
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => event.target.value.trim() && state.status === 'input' && onResolve(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && event.currentTarget.value.trim() && state.status === 'input' && !event.currentTarget.getAttribute('aria-activedescendant')) {
        event.preventDefault();
        onResolve(event.currentTarget.value);
      }
    },
  };
  if (!suggestions?.length) {
    return <Input {...common} value={state.text} onChange={(event) => onType(event.target.value)} />;
  }
  const label = (item: LinkValue) => (kind === 'jira' ? `${item.key} ${item.summary ?? ''}` : item.name || item.fileKey || '');
  return (
    <Combobox<LinkValue>
      items={suggestions}
      inputValue={state.text}
      onInputValueChange={(text) => onType(text)}
      itemToStringLabel={label}
      onValueChange={(item) => item && onResolve(kind === 'jira' ? (item.url ?? item.key ?? '') : (item.url ?? ''))}
    >
      <ComboboxInput {...common} className="w-full" showTrigger={false} />
      <ComboboxContent>
        <ComboboxList>
          {(item: LinkValue) => (
            <ComboboxItem key={item.key ?? item.fileKey} value={item}>
              {kind === 'jira' ? <JiraIcon className="size-3.5" /> : <FigmaIcon className="size-3.5" />}
              {kind === 'jira' && <b>{item.key}</b>}
              <span className="truncate">{kind === 'jira' ? item.summary : item.name || item.fileKey}</span>
              {kind === 'jira' && <span className="ml-auto text-xs text-muted-foreground">{item.status}</span>}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * The row a link field shows once it holds a link, or while it looks one up, or just after it was removed.
 * @param props.kind Which service.
 * @param props.state The field state.
 * @param props.onRemove Takes the link off.
 * @param props.onUndo Puts a removed link back.
 */
function LinkRow({ kind, state, onRemove, onUndo }: { kind: Kind; state: LinkState; onRemove: () => void; onUndo: () => void }) {
  const copy = COPY[kind];
  const value = state.value ?? {};
  const Mark = kind === 'jira' ? JiraIcon : FigmaIcon;
  const openSettings = () => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#connect-${kind}`) });
  if (state.status === 'looking') {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground" aria-busy="true">
        <Mark className="size-4" />
        {copy.looking(value)}
      </div>
    );
  }
  if (state.status === 'removed') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground">
        <span className="flex-1">{copy.removed(value)}</span>
        <Button size="sm" variant="ghost" onClick={onUndo} autoFocus>
          Undo
        </Button>
      </div>
    );
  }
  const problem = state.status === 'noAccess' ? copy.noAccess(value) : state.status === 'otherSite' ? copy.otherSite(state.site) : '';
  const tone = statusTone(value.statusCategory);
  return (
    <div className={cn('rounded-lg border px-3 py-2', problem && 'border-destructive/40')} role={problem ? 'alert' : undefined}>
      <div className="flex items-start gap-2">
        {problem ? <CircleAlert className="mt-0.5 size-4 text-destructive" /> : <Mark className="mt-0.5 size-4" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <div className="flex min-w-0 gap-2">
            <b className="shrink-0">{copy.title(value)}</b>
            {kind === 'jira' && state.status === 'ok' && <span className="truncate text-muted-foreground">{value.summary}</span>}
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {problem && <span className="text-destructive">{problem}</span>}
            {state.status === 'otherSite' && (
              <Button variant="link" size="xs" className="h-auto p-0" onClick={openSettings}>
                Connect it in Help and settings
              </Button>
            )}
            {state.status === 'notConnected' && (
              <Button variant="link" size="xs" className="h-auto p-0" onClick={openSettings}>
                Connect to bring in details
              </Button>
            )}
            {state.status === 'ok' && kind === 'jira' && (
              <>
                <span className={jiraToneClass(tone)}>{value.status}</span>
                <span>{value.assignee}</span>
              </>
            )}
            {state.status === 'ok' && kind === 'figma' && <span>{frameCount(value)}</span>}
          </div>
          {state.status === 'ok' && kind === 'jira' && value.description && <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">{value.description}</p>}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Remove link" title="Remove link">
          <X />
        </Button>
      </div>
    </div>
  );
}

/**
 * One optional link field: a Jira ticket or a Figma file.
 * @param props.kind Which service.
 * @param props.state The field state.
 * @param props.setState Replaces the field state.
 */
function LinkField({ kind, state, setState }: { kind: Kind; state: LinkState; setState: (update: (old: LinkState) => LinkState) => void }) {
  const resolve = async (text: string) => {
    const token = state.token + 1;
    setState((old) => ({ ...old, text, token, status: 'looking', value: COPY[kind].preview(text) ?? old.value }));
    const next = await resolveLink(kind, text, token).catch((error: unknown): LinkState => ({ ...state, text, token, status: 'error', message: String(error) }));
    setState((old) => (old.token === token ? next : old));
  };
  const remove = () => {
    setState((old) => ({ ...old, status: 'removed', previous: old }));
    setTimeout(() => setState((old) => (old.status === 'removed' ? { status: 'input', text: '', value: null, site: '', message: '', token: old.token + 1 } : old)), UNDO_MS);
  };
  const error = errorText(kind, state);
  return (
    <Field data-invalid={BAD.has(state.status) || undefined}>
      <div className="flex justify-between">
        <FieldLabel htmlFor={`review-${kind}`}>{COPY[kind].label}</FieldLabel>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>
      {TYPED.has(state.status) ? (
        <LinkInput kind={kind} state={state} onType={(text) => setState((old) => ({ ...old, text, status: 'input' }))} onResolve={resolve} />
      ) : (
        <LinkRow kind={kind} state={state} onRemove={remove} onUndo={() => setState((old) => old.previous ?? old)} />
      )}
      {error && (
        <FieldError className="flex items-center gap-2">
          {error}
          {state.status === 'error' && (
            <Button size="xs" variant="ghost" onClick={() => resolve(state.text)}>
              Try again
            </Button>
          )}
        </FieldError>
      )}
    </Field>
  );
}

/**
 * Looks up a link field's typed text before saving, when it was never looked up.
 * @param kind Which service.
 * @param state The field state.
 * @param set Replaces the field state.
 */
async function settle(kind: Kind, state: LinkState, set: (state: LinkState) => void) {
  if (state.status !== 'input' || !state.text.trim()) return state;
  const next = await resolveLink(kind, state.text, state.token + 1);
  set(next);
  return next;
}

/**
 * The link a field holds, or null when it holds none.
 * @param state The field state.
 */
const linkOf = (state: LinkState) => (LINKED.has(state.status) ? state.value : null);

/**
 * The sheet's form. Starts from the review being edited, or from a dated name for a new one.
 * @param props.review The review to edit, or null to start one.
 */
function ReviewForm({ review }: { review: Review | null }) {
  const [name, setName] = useState(() => review?.name ?? `Review ${new Date().toLocaleDateString()}`);
  const [nameMissing, setNameMissing] = useState(false);
  const [jira, setJira] = useState(() => initialState(review?.jira, 'jira'));
  const [figma, setFigma] = useState(() => initialState(review?.figma, 'figma'));
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(review);

  const submit = async () => {
    if (!name.trim()) {
      setNameMissing(true);
      return;
    }
    setSaving(true);
    setProblem('');
    const [jiraState, figmaState] = await Promise.all([settle('jira', jira, setJira), settle('figma', figma, setFigma)]);
    const wrong = BAD.has(jiraState.status) ? 'jira' : BAD.has(figmaState.status) ? 'figma' : null;
    if (wrong || jiraState.status === 'looking' || figmaState.status === 'looking') {
      setProblem(wrong ? `Fix or clear the ${COPY[wrong].label} to ${editing ? 'save' : 'start'}` : 'Wait for the lookup to finish');
      setSaving(false);
      return;
    }
    const links = { jira: cleanJiraLink(linkOf(jiraState)), figma: cleanFigmaLink(linkOf(figmaState)) };
    try {
      if (review) {
        await ask('patchReview', { id: review.id, patch: { name: name.trim(), ...links } });
        closeDialog();
        toast.success('Review saved');
      } else {
        const created = await ask('addReview', name.trim());
        await ask('patchReview', { id: created.id, patch: links });
        closeDialog();
        showReview(created.id);
        toast.success(`New comments from the page now go to ${created.name}.`);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field data-invalid={nameMissing || undefined}>
        <FieldLabel htmlFor="review-name">Name</FieldLabel>
        <Input
          id="review-name"
          value={name}
          maxLength={120}
          autoComplete="off"
          autoFocus
          aria-invalid={nameMissing || undefined}
          onFocus={(event) => !editing && event.currentTarget.select()}
          onChange={(event) => {
            setName(event.target.value);
            setNameMissing(false);
          }}
        />
        {nameMissing && <FieldError>Give the review a name</FieldError>}
      </Field>
      <LinkField kind="jira" state={jira} setState={setJira} />
      <LinkField kind="figma" state={figma} setState={setFigma} />
      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-destructive" role="status">
          {problem}
        </span>
        <Button type="button" variant="outline" onClick={closeDialog}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {editing ? 'Save review' : 'Start review'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Starts a review, or edits the shown review's name and links. */
export function ReviewSheetDialog() {
  const dialog = useReportUi((state) => state.dialog);
  const { review } = useReviews();
  const open = dialog === 'newReview' || dialog === 'editReview';
  const editing = dialog === 'editReview' ? review : null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit review' : 'New review'}</DialogTitle>
        </DialogHeader>
        {open && <ReviewForm key={dialog} review={editing} />}
      </DialogContent>
    </Dialog>
  );
}
