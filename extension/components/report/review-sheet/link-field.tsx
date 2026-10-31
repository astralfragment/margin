import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { frameCount, lookUpFigma, lookUpJira, parseFigmaInput, parseJiraInput, recentFigmaFiles, recentJiraIssues, rememberFigmaFile, statusTone } from '@/lib/review-links.js';
import { storageQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { FigmaIcon, JiraIcon } from '../brand-icons';
import type { FigmaLink, JiraLink } from '../types';
import { JIRA_TONE } from '../util';

export type Kind = 'jira' | 'figma';
type Value = Partial<JiraLink & FigmaLink>;
export type LinkStatus = 'input' | 'invalid' | 'notFound' | 'error' | 'looking' | 'ok' | 'notConnected' | 'noAccess' | 'otherSite' | 'removed';
export type LinkState = { status: LinkStatus; text: string; value: Value | null; site?: string; message?: string };

export const LINKED = new Set<LinkStatus>(['ok', 'notConnected', 'noAccess', 'otherSite']);
export const BAD = new Set<LinkStatus>(['invalid', 'notFound', 'error']);
const UNDO_MS = 5000;

const COPY = {
  jira: {
    label: 'Jira ticket',
    placeholder: 'Paste a key like SS-112 or a Jira link',
    search: 'Search your tickets or paste a key',
    invalid: 'That is not a Jira key or link. Paste a key like SS-112 or the link to the issue.',
    notFound: (v: Value) => `No ticket ${v.key} in your Jira sites. Check the key, it stays here to fix.`,
    noAccess: (v: Value) => `You do not have access to ${v.key}`,
    otherSite: (site?: string) => `${site} is not one of your connected Jira sites.`,
    looking: (v: Value) => `Looking up ${v.key}`,
    removed: (v: Value) => `${v.key} removed`,
    title: (v: Value) => v.key ?? '',
    preview: (text: string) => {
      const parsed = parseJiraInput(text);
      return parsed && { key: parsed.key };
    },
  },
  figma: {
    label: 'Figma file',
    placeholder: 'Paste a Figma file link',
    search: 'Search recent files or paste a link',
    invalid: 'That is not a Figma file link. In Figma, choose Share and then Copy link.',
    notFound: () => 'No Figma file at that link. Check the link, it stays here to fix.',
    noAccess: () => 'You do not have access to this Figma file. Connecting Figma again in Help and settings may fix it.',
    otherSite: () => '',
    looking: (v: Value) => `Looking up ${v.name || 'the Figma file'}`,
    removed: (v: Value) => `${v.name || 'Figma file'} removed`,
    title: (v: Value) => v.name || 'Figma file',
    preview: (text: string) => parseFigmaInput(text),
  },
};

/** The state a link field starts in, from the review's stored link. */
export function initialLink(kind: Kind, value: Value | null | undefined): LinkState {
  if (!value) return { status: 'input', text: '', value: null };
  const known = kind === 'jira' ? value.summary || value.status : value.frames?.length;
  return { status: known ? 'ok' : 'notConnected', text: '', value };
}

type Props = {
  kind: Kind;
  state: LinkState;
  onChange: (state: LinkState) => void;
  connected: boolean;
  /** Registers the lookup in flight, so saving can wait for it. */
  onPending: (pending: Promise<void> | null) => void;
  autoFocus?: boolean;
};

/**
 * A review's Jira ticket or Figma file: paste a key or link, or pick a recent one. The link is looked up when
 * the service is connected, shown with its details, and can be removed with five seconds to undo.
 */
export function LinkField({ kind, state, onChange, connected, onPending, autoFocus }: Props) {
  const copy = COPY[kind];
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const token = useRef(0);
  const previous = useRef<LinkState | null>(null);
  const [open, setOpen] = useState(false);
  const recent = useQuery({
    ...storageQuery(['recent-links', kind], kind === 'figma' ? ['figmaRecent'] : ['connections'], () => (kind === 'jira' ? recentJiraIssues() : recentFigmaFiles()) as Promise<Value[]>),
    enabled: connected && open,
  });
  const suggestions = recent.data ?? null;
  const [highlight, setHighlight] = useState(-1);
  const live = useRef(state);
  live.current = state;

  /** Looks up what was typed. A newer lookup replaces an older one. */
  const resolve = (text: string) => {
    if (!text.trim()) return onChange({ status: 'input', text, value: null });
    const preview = copy.preview(text);
    if (!preview) return onChange({ status: 'invalid', text, value: null });
    const mine = ++token.current;
    onChange({ status: 'looking', text, value: preview });
    const pending = (kind === 'jira' ? lookUpJira(text) : lookUpFigma(text)).then(async (res: { state: LinkStatus; jira?: Value; figma?: Value; message?: string; site?: string }) => {
      if (mine !== token.current) return;
      const value = res.jira ?? res.figma ?? preview;
      if (kind === 'figma' && LINKED.has(res.state)) await rememberFigmaFile(value as FigmaLink);
      onChange({ status: res.state, text, value, message: res.message ?? '', site: res.site ?? '' });
      onPending(null);
    });
    onPending(pending);
  };

  const items = (suggestions ?? []).filter((item) => {
    const q = state.text.trim().toLowerCase();
    return [item.key, item.summary, item.name].some((part) => part && part.toLowerCase().includes(q));
  });
  const showList = open && items.length > 0 && state.status === 'input';

  const pick = (item: Value) => {
    setOpen(false);
    if (kind === 'jira') {
      token.current += 1;
      onChange({ status: 'ok', text: item.key ?? '', value: item });
    } else {
      resolve(item.url ?? '');
    }
  };

  const typed = state.status === 'input' || BAD.has(state.status);
  const v = state.value ?? {};
  const Mark = kind === 'jira' ? JiraIcon : FigmaIcon;
  const errorText =
    state.status === 'invalid' ? copy.invalid : state.status === 'notFound' ? copy.notFound(v) : state.status === 'error' ? `Could not look this up. ${state.message}` : '';

  /** Takes the link off and offers Undo for five seconds, then leaves an empty input. */
  const remove = () => {
    previous.current = state;
    onChange({ ...state, status: 'removed' });
    setTimeout(() => {
      if (live.current.status === 'removed') onChange({ status: 'input', text: '', value: null });
    }, UNDO_MS);
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {copy.label}
        </label>
        <span className="text-sm font-medium text-muted-foreground">Optional</span>
      </div>
      {typed ? (
        <div className="relative">
          <Input
            ref={input}
            id={id}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={`${id}-list`}
            aria-expanded={showList}
            aria-activedescendant={showList && highlight >= 0 ? `${id}-${highlight}` : undefined}
            aria-invalid={BAD.has(state.status) || undefined}
            placeholder={open && suggestions?.length ? copy.search : copy.placeholder}
            value={state.text}
            onFocus={() => setOpen(true)}
            onBlur={() =>
              setTimeout(() => {
                setOpen(false);
                if (live.current.status === 'input' && live.current.text.trim()) resolve(live.current.text);
              }, 150)
            }
            onChange={(e) => {
              setHighlight(-1);
              onChange({ status: 'input', text: e.target.value, value: null });
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (!text.trim()) return;
              e.preventDefault();
              resolve(text.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && showList) {
                e.preventDefault();
                setHighlight((h) => (h + 1) % items.length);
              } else if (e.key === 'ArrowUp' && showList) {
                e.preventDefault();
                setHighlight((h) => (h - 1 + items.length) % items.length);
              } else if (e.key === 'Enter' && showList && highlight >= 0) {
                e.preventDefault();
                pick(items[highlight]!);
              } else if (e.key === 'Enter' && state.text.trim() && state.status === 'input') {
                e.preventDefault();
                resolve(state.text);
              } else if (e.key === 'Escape' && showList) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          {showList && (
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label={`${copy.label} suggestions`}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10"
            >
              {items.map((item, i) => (
                <li
                  key={item.key ?? item.fileKey}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  onClick={() => pick(item)}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent hover:bg-accent"
                >
                  <Mark className="text-muted-foreground" />
                  {kind === 'jira' && <b className="shrink-0 font-semibold">{item.key}</b>}
                  <span className="min-w-0 flex-1 truncate">{kind === 'jira' ? item.summary : item.name || item.fileKey}</span>
                  {kind === 'jira' && <span className="shrink-0 text-sm font-medium text-muted-foreground">{item.status}</span>}
                </li>
              ))}
            </ul>
          )}
          {errorText && (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlert className="mt-px size-4 shrink-0" />
              <span className="flex-1">{errorText}</span>
              {state.status === 'error' && (
                <Button variant="ghost" size="xs" onClick={() => resolve(state.text)}>
                  Try again
                </Button>
              )}
            </p>
          )}
        </div>
      ) : state.status === 'removed' ? (
        <div className="flex h-12 items-center justify-between gap-3 rounded-lg border border-dashed px-3 text-sm font-medium text-muted-foreground">
          {copy.removed(v)}
          <Button
            variant="ghost"
            size="sm"
            autoFocus
            onClick={() => {
              if (previous.current) onChange(previous.current);
            }}
          >
            Undo
          </Button>
        </div>
      ) : (
        <div className={cn('grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-3 py-2', (state.status === 'noAccess' || state.status === 'otherSite') && 'border-destructive/50')}>
          {state.status === 'noAccess' || state.status === 'otherSite' ? <CircleAlert className="size-4 text-destructive" /> : <Mark className="text-muted-foreground" />}
          <div className="grid min-w-0 gap-0.5" aria-busy={state.status === 'looking' || undefined}>
            {state.status === 'looking' ? (
              <>
                <span className="h-4 w-32 animate-pulse rounded-sm bg-muted" />
                <span className="text-sm font-medium text-muted-foreground">{copy.looking(v)}</span>
              </>
            ) : (
              <>
                <span className="flex min-w-0 items-baseline gap-2 text-sm">
                  <b className="shrink-0 font-semibold">{copy.title(v)}</b>
                  {kind === 'jira' && state.status === 'ok' && <span className="truncate">{v.summary}</span>}
                </span>
                <span className="flex min-w-0 gap-2 text-sm font-medium text-muted-foreground">
                  {state.status === 'ok' && kind === 'jira' && (
                    <>
                      <span className={JIRA_TONE[statusTone(v.statusCategory)]}>{v.status}</span>
                      <span className="truncate">{v.assignee}</span>
                    </>
                  )}
                  {state.status === 'ok' && kind === 'figma' && frameCount(v)}
                  {state.status === 'notConnected' && (
                    <button type="button" className="underline underline-offset-3 hover:text-foreground" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#connect-${kind}`) })}>
                      Connect to bring in details
                    </button>
                  )}
                  {state.status === 'noAccess' && <span className="text-destructive">{copy.noAccess(v)}</span>}
                  {state.status === 'otherSite' && <span className="text-destructive">{copy.otherSite(state.site)}</span>}
                </span>
              </>
            )}
          </div>
          {state.status !== 'looking' && (
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${copy.label}`} onClick={remove}>
              <X />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
