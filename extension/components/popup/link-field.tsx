import { useId, useState, type ReactNode } from 'react';
import { Frame, Ticket, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { frameCount } from '@/lib/review-links.js';
import { cn } from '@/lib/utils';
import { IconButton } from './icon-button';
import { JiraStatus } from './jira-status';
import type { Link, LinkKind } from './model';
import { BAD, TYPED, type FieldState, type FocusTarget, type LinkFieldApi } from './use-link-field';

const COPY = {
  jira: {
    label: 'Jira ticket',
    placeholder: 'Paste a key like SS-112 or a Jira link',
    search: 'Search your tickets or paste a key',
    invalid: 'That is not a Jira key or link. Paste a key like SS-112 or the link to the issue.',
    notFound: (v: Link) => `No ticket ${v.key} in your Jira sites. Check the key, it stays here to fix.`,
    noAccess: (v: Link) => `You do not have access to ${v.key}.`,
    otherSite: (site: string) => `${site} is not one of your connected Jira sites.`,
    looking: (v: Link) => `Looking up ${v.key}`,
    removed: (v: Link) => `${v.key} removed`,
    title: (v: Link) => v.key ?? '',
  },
  figma: {
    label: 'Figma file',
    placeholder: 'Paste a Figma file link',
    search: 'Search recent files or paste a link',
    invalid: 'That is not a Figma file link. In Figma, choose Share and then Copy link.',
    notFound: () => 'No Figma file at that link. Check the link, it stays here to fix.',
    noAccess: () => 'You do not have access to this Figma file. Connecting Figma again in Help and settings may fix it.',
    otherSite: () => '',
    looking: (v: Link) => `Looking up ${v.name || 'the Figma file'}`,
    removed: (v: Link) => `${v.name || 'Figma file'} removed`,
    title: (v: Link) => v.name || 'Figma file',
  },
};

const DESCRIPTION_FOLD = 160;

/** Keeps Jira keys such as SS-112 on one line when a message wraps. */
const withKeys = (text: string) =>
  text.split(/(\b[A-Z][A-Z0-9_]*-\d+\b)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part));

type Props = { api: LinkFieldApi; autoFocus?: boolean; focusNext: () => void; onConnect: (kind: LinkKind) => void };

/** A Jira or Figma link on the review sheet: an input with suggestions, or the linked ticket or file. */
export function LinkField({ api, autoFocus, focusNext, onConnect }: Props) {
  const { kind, field } = api;
  const id = useId();
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={`${id}-input`} className="text-sm font-semibold">
          {COPY[kind].label}
        </label>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>
      {TYPED.has(field.status) ? (
        <LinkInput api={api} id={id} autoFocus={Boolean(autoFocus) || api.focus === 'input'} focusNext={focusNext} />
      ) : (
        <LinkRow kind={kind} field={field} focus={autoFocus ? 'remove' : api.focus} onRemove={api.remove} onUndo={api.undo} onConnect={() => onConnect(kind)} />
      )}
    </div>
  );
}

/**
 * The field where a Jira or Figma link is pasted.
 * @param props The field state, its id and focus handling.
 */
function LinkInput({ api, id, autoFocus, focusNext }: { api: LinkFieldApi; id: string; autoFocus: boolean; focusNext: () => void }) {
  const { kind, field } = api;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const query = field.text.trim().toLowerCase();
  const items = api.suggestions.filter((item) => [item.key, item.summary, item.name].some((part) => part?.toLowerCase().includes(query)));
  const showList = open && items.length > 0 && field.status === 'input';
  const bad = BAD.has(field.status);
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  const lookUp = (text: string) => {
    focusNext();
    api.resolve(text);
  };
  const pick = (item: Link) => {
    setOpen(false);
    focusNext();
    api.pick(item);
  };

  return (
    <div className="relative grid gap-2">
      <Input
        id={`${id}-input`}
        autoFocus={autoFocus}
        data-focus="input"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showList}
        aria-activedescendant={showList && highlight >= 0 ? optionId(highlight) : undefined}
        aria-invalid={bad}
        placeholder={open && items.length ? COPY[kind].search : COPY[kind].placeholder}
        value={field.text}
        className="h-9 text-sm"
        onFocus={() => {
          setOpen(true);
          api.setSearching(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            api.settle();
          }, 150);
        }}
        onChange={(event) => {
          setHighlight(-1);
          api.setText(event.target.value);
        }}
        onPaste={(event) => {
          const input = event.currentTarget;
          setTimeout(() => input.value.trim() && lookUp(input.value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && showList) {
            event.preventDefault();
            setHighlight((highlight + 1) % items.length);
          } else if (event.key === 'ArrowUp' && showList) {
            event.preventDefault();
            setHighlight((highlight - 1 + items.length) % items.length);
          } else if (event.key === 'Enter' && showList && highlight >= 0) {
            event.preventDefault();
            pick(items[highlight]!);
          } else if (event.key === 'Enter' && field.text.trim() && field.status === 'input') {
            event.preventDefault();
            lookUp(field.text);
          } else if (event.key === 'Escape' && showList) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${COPY[kind].label} suggestions`}
        hidden={!showList}
        onMouseDown={(event) => event.preventDefault()}
        className="absolute top-10 right-0 left-0 z-10 max-h-48 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10"
      >
        {items.map((item, i) => (
          <li
            key={item.key ?? item.fileKey}
            id={optionId(i)}
            role="option"
            aria-selected={i === highlight}
            onClick={() => pick(item)}
            className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent hover:bg-accent"
          >
            {kind === 'jira' ? <Ticket className="size-4 shrink-0 text-muted-foreground" /> : <Frame className="size-4 shrink-0 text-muted-foreground" />}
            {item.key && <b className="shrink-0">{item.key}</b>}
            <span className="min-w-0 flex-1 truncate" title={item.summary ?? item.name}>
              {item.summary ?? (item.name || item.fileKey)}
            </span>
            {item.status && <span className="shrink-0 text-xs text-muted-foreground">{item.status}</span>}
          </li>
        ))}
      </ul>
      {bad && <FieldError field={field} kind={kind} onRetry={() => api.resolve()} />}
    </div>
  );
}

/**
 * Says why a link could not be read and how to fix it.
 * @param props The field state, its kind and a retry.
 */
function FieldError({ field, kind, onRetry }: { field: FieldState; kind: LinkKind; onRetry: () => void }) {
  const copy = COPY[kind];
  const text =
    field.status === 'invalid' ? copy.invalid : field.status === 'notFound' ? copy.notFound(field.value ?? {}) : `Could not look this up. ${field.message}`;
  return (
    <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
      <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
      <span className="flex-1">{withKeys(text)}</span>
      {field.status === 'error' && (
        <Button variant="link" size="xs" className="h-auto px-0" onClick={onRetry}>
          Try again
        </Button>
      )}
    </p>
  );
}

type RowProps = { kind: LinkKind; field: FieldState; focus: FocusTarget; onRemove: () => void; onUndo: () => void; onConnect: () => void };

/**
 * A linked Jira ticket or Figma file, with its actions.
 * @param props The link, its state and handlers.
 */
function LinkRow({ kind, field, focus, onRemove, onUndo, onConnect }: RowProps) {
  const copy = COPY[kind];
  const v = field.value ?? {};
  const Icon = kind === 'jira' ? Ticket : Frame;
  if (field.status === 'looking') {
    return (
      <Row icon={<Icon />} busy>
        <span className="h-4 w-32 animate-pulse rounded-sm bg-muted" />
        <span className="text-xs text-muted-foreground">{copy.looking(v)}</span>
      </Row>
    );
  }
  if (field.status === 'removed') {
    return (
      <Row className="bg-muted/60" action={<Button size="sm" variant="outline" data-focus="undo" autoFocus={focus === 'undo'} onClick={onUndo}>Undo</Button>}>
        <span className="text-muted-foreground">{copy.removed(v)}</span>
      </Row>
    );
  }
  const removeButton = (
    <IconButton label="Remove link" size="icon-sm" side="left" autoFocus={focus === 'remove'} onClick={onRemove}>
      <X />
    </IconButton>
  );
  if (field.status === 'noAccess' || field.status === 'otherSite') {
    return (
      <Row icon={<TriangleAlert className="text-destructive" />} className="border-destructive/30 bg-destructive/5" action={removeButton} alert>
        <b className="truncate">{copy.title(v)}</b>
        <span className="text-xs text-muted-foreground">
          {field.status === 'noAccess' ? copy.noAccess(v) : copy.otherSite(field.site)}
          {field.status === 'otherSite' && (
            <Button variant="link" size="xs" className="h-auto px-1" onClick={onConnect}>
              Connect it in Help and settings
            </Button>
          )}
        </span>
      </Row>
    );
  }
  if (field.status === 'notConnected') {
    return (
      <Row icon={<Icon />} action={removeButton}>
        <b className="truncate">{copy.title(v)}</b>
        <Button variant="link" size="xs" className="h-auto justify-self-start px-0 text-muted-foreground" onClick={onConnect}>
          Connect to bring in details
        </Button>
      </Row>
    );
  }
  return (
    <div className="grid gap-2">
      <Row icon={<Icon />} action={removeButton}>
        <span className="flex min-w-0 items-center gap-2">
          {kind === 'jira' && <b className="shrink-0">{v.key}</b>}
          <span className={cn('truncate', kind === 'figma' && 'font-semibold')} title={kind === 'jira' ? v.summary : v.name}>
            {kind === 'jira' ? v.summary : v.name || 'Figma file'}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {kind === 'jira' ? (
            <>
              {v.status && <JiraStatus status={v.status} category={v.statusCategory} />}
              <span className="truncate">{v.assignee}</span>
            </>
          ) : (
            frameCount(v)
          )}
        </span>
      </Row>
      {kind === 'jira' && v.description && <Description text={v.description} />}
    </div>
  );
}

/**
 * One line of the links area, with an icon and an action.
 * @param props The icon, action, state and content.
 */
function Row({ icon, action, busy, alert, className, children }: { icon?: ReactNode; action?: ReactNode; busy?: boolean; alert?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      aria-busy={busy || undefined}
      role={alert ? 'alert' : undefined}
      className={cn('flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-sm animate-in fade-in-0 motion-reduce:animate-none', className)}
    >
      {icon && <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="grid min-w-0 flex-1 gap-1">{children}</span>
      {action}
    </div>
  );
}

/**
 * The muted line under a link title.
 * @param props The text.
 */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > DESCRIPTION_FOLD;
  return (
    <div className="grid justify-items-start gap-1 px-1">
      <p className={cn('text-xs whitespace-pre-line text-muted-foreground', long && !open && 'line-clamp-3')}>{text}</p>
      {long && (
        <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
