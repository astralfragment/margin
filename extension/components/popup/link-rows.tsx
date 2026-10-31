import { Frame, LoaderCircle, RefreshCw, Ticket } from 'lucide-react';
import { detailsAt, frameCount, timeAgo } from '@/lib/review-links.js';
import { IconButton } from './icon-button';
import type { Group, Link, LinkKind } from './model';
import { JiraStatus } from './jira-status';

type Props = {
  group: Group;
  connected: Record<LinkKind, boolean>;
  refreshing: boolean;
  failed: boolean;
  onRefresh: () => void;
  onConnect: (kind: LinkKind) => void;
  onOpen: (url: string) => void;
};

const TEXT_LINK = 'rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50';

/** The review's linked ticket and file, two lines each, with how fresh their details are on one footer line. */
export function LinkRows({ group, connected, refreshing, failed, onRefresh, onConnect, onOpen }: Props) {
  const links = (['jira', 'figma'] as const).filter((kind) => (kind === 'jira' ? group.jira?.key : group.figma?.fileKey));
  if (!links.length) return null;
  return (
    <section aria-label="Linked ticket and file" className="grid rounded-xl border">
      <div className="grid gap-3 p-3">
        {links.map((kind) => (
          <LinkRow key={kind} kind={kind} link={group[kind]!} onConnect={onConnect} onOpen={onOpen} />
        ))}
      </div>
      <Freshness group={group} connected={connected} refreshing={refreshing} failed={failed} onRefresh={onRefresh} onConnect={onConnect} />
    </section>
  );
}

/**
 * One of the review's links, opened or connected from the popup.
 * @param props The kind, the link and handlers.
 */
function LinkRow({ kind, link, onConnect, onOpen }: { kind: LinkKind; link: Link; onConnect: (kind: LinkKind) => void; onOpen: (url: string) => void }) {
  const Icon = kind === 'jira' ? Ticket : Frame;
  const service = kind === 'jira' ? 'Jira' : 'Figma';
  const title = kind === 'jira' ? link.key : link.name || 'Figma file';
  const detail = kind === 'jira' ? link.summary : link.frames?.length ? frameCount(link) : '';
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            disabled={!link.url}
            title={link.url || `Connect ${service} or paste the full link to open it`}
            onClick={() => link.url && onOpen(link.url)}
            className={`min-w-0 truncate text-left text-sm ${TEXT_LINK} disabled:no-underline`}
          >
            {title}
          </button>
          {kind === 'jira' && link.status && <JiraStatus status={link.status} category={link.statusCategory} />}
        </div>
        {link.fetchedAt ? (
          detail && (
            <span className="truncate text-xs font-medium text-muted-foreground" title={detail}>
              {detail}
            </span>
          )
        ) : (
          <button type="button" className={`justify-self-start text-xs underline ${TEXT_LINK}`} onClick={() => onConnect(kind)}>
            Connect to bring in details
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * When the links' details were last fetched, with a refresh.
 * @param props The review, connection state and handlers.
 */
function Freshness({ group, connected, refreshing, failed, onRefresh, onConnect }: Omit<Props, 'onOpen'>) {
  const at = detailsAt(group) as number | null;
  const off = (['jira', 'figma'] as const).find((kind) => group[kind]?.fetchedAt && !connected[kind]);
  if (!at && !refreshing && !failed) return null;
  let text = at ? `Details from ${timeAgo(at)}` : '';
  let action = (
    <IconButton label="Refresh details" side="left" className="-my-1 -mr-2" onClick={onRefresh}>
      <RefreshCw />
    </IconButton>
  );
  if (refreshing) {
    text = 'Refreshing details';
    action = <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />;
  } else if (failed) {
    text = 'Could not refresh';
    action = (
      <button type="button" className={`text-xs ${TEXT_LINK} underline`} onClick={onRefresh}>
        Try again
      </button>
    );
  } else if (off) {
    action = (
      <button type="button" className={`text-xs ${TEXT_LINK} underline`} onClick={() => onConnect(off)}>
        Connect to refresh
      </button>
    );
  }
  return (
    <p role={failed ? 'alert' : 'status'} className="flex h-10 items-center gap-2 border-t px-3 text-xs font-medium text-muted-foreground">
      <span className={failed ? 'flex-1 text-destructive' : 'flex-1'}>{text}</span>
      {action}
    </p>
  );
}
