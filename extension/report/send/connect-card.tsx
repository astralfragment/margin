import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
 * @param props.provider The service.
 * @param props.body What connecting gives.
 */
export function ConnectCard({ provider, body }: { provider: Provider; body: string }) {
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
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <b className="text-sm">Connect {name}</b>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="bg-action text-action-foreground hover:bg-action/80" disabled={busy} onClick={start}>
          Connect {name}
        </Button>
        <span className="text-sm text-muted-foreground" role="status">
          {state}
        </span>
      </div>
    </div>
  );
}
