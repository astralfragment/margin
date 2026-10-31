import { useQuery } from '@tanstack/react-query';
import { Eye, Info, KeyRound, LogOut } from 'lucide-react';
import { useStorageValue } from '@/hooks/use-storage';
import { storageQuery } from '@/lib/query';
import { readConnections } from '@/lib/oauth.js';
import { ConnectionRow, ConnectionRowLoading, type StoredConnection } from './connection-row';
import { useSettingsStore, type Provider } from './store';

const FACTS = [
  { icon: Eye, text: 'Nothing is sent until you choose Send to Jira or Send to Figma in the report, and you see what goes before it goes.' },
  { icon: KeyRound, text: 'Margin asks Chrome for access to a service only when you click Connect.' },
  { icon: LogOut, text: 'Disconnect signs you out and removes that access.' },
];

/** True when the page opened on a link from the review sheet, such as options.html#connect-jira. */
const CAME_TO_CONNECT = location.hash.startsWith('#connect-');

/** The note for someone who left an unfinished review sheet to connect a service, or null when there is none. */
function useReturnNote() {
  const { data: draft } = useStorageValue<unknown>('reviewDraft', null);
  const connectedName = useSettingsStore((state) => state.connectedName);
  if (!CAME_TO_CONNECT || !draft) return null;
  if (connectedName) return `${connectedName} is connected. Click Margin in the toolbar to finish your review.`;
  return 'Your review sheet is kept. Once connected, click Margin in the toolbar to finish it.';
}

/** Jira and Figma: optional, with what they do and who is signed in. */
export function ConnectionsTab({ focus }: { focus?: Provider }) {
  const { data: all } = useQuery(storageQuery(['connections'], ['connections'], async () => (await readConnections()) as Record<string, StoredConnection>));
  const note = useReturnNote();
  return (
    <div className="grid gap-6">
      <p className="max-w-[62ch] text-sm leading-6 font-medium text-muted-foreground">
        Connections are optional. Copy for Docs, Word and HTML files work without them. Connect Jira or Figma if you want to send comments straight there. You sign in once on this computer.
      </p>

      {note && (
        <p role="status" className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm leading-5">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {note}
        </p>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
        {(['jira', 'figma'] as const).map((provider) =>
          all ? <ConnectionRow key={provider} provider={provider} current={all[provider] ?? null} focused={focus === provider} /> : <ConnectionRowLoading key={provider} provider={provider} />,
        )}
      </ul>

      <ul className="grid gap-3">
        {FACTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm leading-5 font-medium text-muted-foreground">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
