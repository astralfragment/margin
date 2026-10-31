import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { statusTone } from '@/lib/review-links.js';
import { cn } from '@/lib/utils';
import { FigmaIcon, JiraIcon } from './brand-icons';
import type { Group } from './types';
import { JIRA_TONE, openTab } from './util';


/** The review's linked Jira ticket and Figma file. Each opens in a new tab, or leads to connecting the service. */
export function LinkChips({ group }: { group: Group | null }) {
  const jira = group?.jira?.key ? group.jira : null;
  const figma = group?.figma?.fileKey ? group.figma : null;
  if (!jira && !figma) return null;
  const open = (url?: string) => (url ? openTab(url) : chrome.runtime.openOptionsPage());
  return (
    <div className="hidden min-w-0 items-center gap-1 sm:flex">
      {jira && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" className="min-w-0 text-muted-foreground hover:text-foreground" onClick={() => open(jira.url)} />}>
            <JiraIcon />
            <span className="font-semibold text-foreground">{jira.key}</span>
            {jira.status && <span className={cn('hidden truncate lg:inline', JIRA_TONE[statusTone(jira.statusCategory)])}>{jira.status}</span>}
          </TooltipTrigger>
          <TooltipContent>{jira.url ? `Open ${jira.key}${jira.summary ? `, ${jira.summary}` : ''}` : 'Connect Jira in Help and settings to bring in details'}</TooltipContent>
        </Tooltip>
      )}
      {figma && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" className="min-w-0 text-muted-foreground hover:text-foreground" onClick={() => open(figma.url)} aria-label={figma.name || 'Figma file'} />}>
            <FigmaIcon />
            <span className="hidden max-w-40 truncate text-foreground lg:inline">{figma.name || 'Figma file'}</span>
          </TooltipTrigger>
          <TooltipContent>{figma.url ? `Open ${figma.name || 'the Figma file'}` : 'Connect Figma in Help and settings to bring in details'}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
