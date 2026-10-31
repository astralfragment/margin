import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { connect, requestAccess } from '@/lib/oauth.js';

type Props = { provider: 'jira' | 'figma'; name: string; body: string };

/** Signs in to Jira or Figma from inside a send dialog. The dialog follows the stored connection. */
export function ConnectCard({ provider, name, body }: Props) {
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    const access = requestAccess(provider);
    setBusy(true);
    setState(`Waiting for ${name} sign-in`);
    try {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
      await connect(provider);
    } catch (err) {
      setState((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold">Connect {name}</p>
        <p className="text-sm font-medium text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={go} disabled={busy}>
          Connect {name}
        </Button>
        <span className="text-sm font-medium text-muted-foreground" role="status">
          {state}
        </span>
      </div>
    </div>
  );
}
