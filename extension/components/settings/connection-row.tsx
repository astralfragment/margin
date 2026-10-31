import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROVIDERS, requestAccess, connect, disconnect } from '@/lib/oauth.js';
import { BrandMark } from './brand-mark';
import { useSettingsStore, type Provider } from './store';

export type StoredConnection = {
  account?: { name?: string; email?: string };
  sites?: { name: string }[];
};

const SIGN_IN_WAIT = 2 * 60_000;
const SETTLE_MS = 800;

const SERVICES: Record<Provider, string> = {
  jira: 'Turns each comment into a Jira issue with its screenshot attached. You pick the project and issue type first.',
  figma: 'Adds each comment to the Figma frame it links to, so designers see it in Figma. Paste a Figma frame link on a comment to use it.',
};

/** The row's frame, shared with the loading placeholder so nothing shifts once connections load. */
function RowFrame({ provider, children, onKeyDown }: { provider: Provider; children: ReactNode; onKeyDown?: (event: KeyboardEvent) => void }) {
  return (
    <li id={`connect-${provider}`} onKeyDown={onKeyDown} className="grid scroll-mt-24 grid-cols-[auto_1fr] gap-x-4 gap-y-4 p-4 sm:grid-cols-[auto_1fr_auto]">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
        <BrandMark brand={provider} className="size-5" />
      </span>
      {children}
    </li>
  );
}

/**
 * The name and status of a connection.
 * @param props The service, a badge and the status line.
 */
function RowText({ provider, badge, status }: { provider: Provider; badge?: ReactNode; status: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{PROVIDERS[provider].name}</h3>
        {badge}
      </div>
      <p className="text-sm leading-5 font-medium text-muted-foreground">{SERVICES[provider]}</p>
      <p role="status" className="text-sm leading-5 font-medium text-muted-foreground">
        {status}
      </p>
    </div>
  );
}

/** Stands in for a row while connections load. */
export function ConnectionRowLoading({ provider }: { provider: Provider }) {
  return (
    <RowFrame provider={provider}>
      <RowText provider={provider} status={<span className="inline-block h-4 w-40 animate-pulse rounded-sm bg-muted align-middle" />} />
    </RowFrame>
  );
}

type Props = {
  provider: Provider;
  /** The stored connection, null when not connected. */
  current: StoredConnection | null;
  /** Moves focus to the main button when it first shows, for links such as options.html#connect-jira. */
  focused?: boolean;
};

/** One service: what it does, who is signed in, and Connect or Disconnect with a confirm, a wait and a way to cancel each. */
export function ConnectionRow({ provider, current, focused }: Props) {
  const name: string = PROVIDERS[provider].name;
  const { busy, message, settling } = useSettingsStore((state) => state.rows[provider]);
  const { patch, nextAttempt, setConnectedName } = useSettingsStore.getState();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const connected = Boolean(current);

  const attachButton = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el;
      if (!el || !focused) return;
      el.closest('li')?.scrollIntoView({ block: 'center' });
      el.focus();
    },
    [focused],
  );

  const signIn = useMutation({
    mutationFn: async (access: Promise<boolean>) => {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
      return connect(provider);
    },
  });
  const signOut = useMutation({ mutationFn: () => disconnect(provider) });

  const isCurrent = (attempt: number) => attempt === useSettingsStore.getState().attempts[provider];

  const settle = () => {
    patch(provider, { settling: true });
    setTimeout(() => patch(provider, { settling: false }), SETTLE_MS);
  };

  /** Leaves the question or the wait, so the row shows what is stored. */
  const reset = (nextMessage: string | null = null) => {
    nextAttempt(provider);
    patch(provider, { busy: null, message: nextMessage });
  };

  const cancelAsking = () => {
    reset();
    buttonRef.current?.focus();
  };

  const onMain = async () => {
    if (busy === 'waiting') {
      reset(`${name} sign-in stopped. Connect to try again.`);
      return;
    }
    if (connected) {
      if (busy !== 'asking') {
        patch(provider, { busy: 'asking', message: null });
        return;
      }
      patch(provider, { busy: null });
      await signOut.mutateAsync();
      settle();
      return;
    }
    // Chrome only grants access when asked straight from the click, before any await.
    const access = requestAccess(provider);
    const attempt = nextAttempt(provider);
    patch(provider, { busy: 'waiting', message: null });
    const timer = setTimeout(() => {
      if (isCurrent(attempt)) reset(`${name} sign-in did not finish. Connect to try again.`);
    }, SIGN_IN_WAIT);
    try {
      await signIn.mutateAsync(access);
      if (!isCurrent(attempt)) return;
      patch(provider, { busy: null });
      settle();
      setConnectedName(name);
    } catch (err) {
      if (isCurrent(attempt)) patch(provider, { busy: null, message: err instanceof Error ? err.message : String(err) });
    } finally {
      clearTimeout(timer);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && busy === 'asking') cancelAsking();
  };

  const who = [current?.account?.name, current?.account?.email].filter(Boolean).join(', ') || 'your account';
  const sites = current?.sites?.map((site) => site.name).join(', ');

  let status: ReactNode;
  if (busy === 'asking') status = <span className="font-semibold text-destructive">Disconnect {name}? Connecting again needs a full sign-in.</span>;
  else if (busy === 'waiting')
    status = (
      <span className="inline-flex items-center gap-2">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Waiting for {name} sign-in. Finish it in the window that opened.
      </span>
    );
  else if (message && !connected) status = <span className="text-foreground">{message}</span>;
  else if (connected)
    status = (
      <span>
        Signed in as <span className="font-semibold text-foreground">{who}</span>.{sites ? ` Jira sites ${sites}.` : ''} Send from the report under More.
      </span>
    );
  else status = 'Not connected.';

  let label = 'Connect';
  if (busy === 'waiting') label = 'Cancel';
  else if (connected) label = 'Disconnect';

  const badge = connected && (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
      <CircleCheck aria-hidden className="size-4" />
      Connected
    </span>
  );

  return (
    <RowFrame provider={provider} onKeyDown={onKeyDown}>
      <RowText provider={provider} badge={badge} status={status} />
      <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:row-start-1 sm:self-center">
        {busy === 'asking' && (
          <Button variant="ghost" onClick={cancelAsking}>
            Cancel
          </Button>
        )}
        <Button ref={attachButton} disabled={settling} onClick={onMain} variant={busy === 'asking' ? 'destructive' : 'outline'}>
          {label}
        </Button>
      </div>
    </RowFrame>
  );
}
