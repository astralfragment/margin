import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Connection, Provider } from '@/lib/model';
import { queryClient } from '../data';
import { connect, requestAccess } from '../shared';

const NAMES: Record<Provider, string> = { jira: 'Jira', figma: 'Figma' };

/**
 * The line under a send dialog's title: who is signed in, or that nobody is.
 * @param current The stored connection, or null when not connected, or undefined while it loads.
 * @param fallback The account's name when the connection does not carry one.
 */
export function connectionLine(current: Connection | null | undefined, fallback: string) {
  if (current === undefined) return '';
  if (!current) return 'Not connected';
  return `Connected as ${current.account?.name || current.account?.email || fallback}`;
}

/**
 * Signs in to Jira or Figma from inside a send dialog. Host access is asked for in the click itself, which Chrome
 * requires, and the dialog redraws once the connection is stored.
 * @param provider The service.
 */
export function useConnect(provider: Provider) {
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const name = NAMES[provider];
  const start = async () => {
    const access = requestAccess(provider);
    setBusy(true);
    setState(`Waiting for ${name} sign-in`);
    try {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
      await connect(provider);
      await queryClient.invalidateQueries({ queryKey: ['connection', provider] });
    } catch (error) {
      setState(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  return { name, state, busy, start };
}

/**
 * The button that starts the sign-in, the one main action of a send dialog that is not connected yet.
 * @param props.connection What `useConnect` returned.
 */
export function ConnectButton({ connection }: { connection: ReturnType<typeof useConnect> }) {
  return (
    <Button disabled={connection.busy} onClick={connection.start}>
      {connection.busy && <Spinner />}
      Connect {connection.name}
    </Button>
  );
}

/**
 * What connecting gives, and the sign-in's progress or error under it.
 * @param props.body What connecting gives.
 * @param props.state The sign-in's progress or error.
 * @param props.children More lines after the first.
 */
export function ConnectIntro({ body, state, children }: { body: string; state: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 text-sm" aria-live="polite">
      <p>{body}</p>
      {children}
      {state && <p className="text-muted-foreground">{state}</p>}
    </div>
  );
}
