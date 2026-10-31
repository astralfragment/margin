import { ArrowDownUp, Check, MessageSquareDashed, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SeverityIcon } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { SEVERITIES, severityOf } from '@/lib/severity.js';
import { STATUSES, statusOf } from '@/lib/status.js';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { NO_FILTERS, type Filters } from './store';
import type { Section } from './use-report';
import type { Issue, SortOrder } from './types';
import { hostOf, pad } from './util';


type Props = {
  ordered: Issue[];
  sections: Section[];
  numberOf: (issue: Issue) => number;
  visible: boolean[];
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  sortOrder: SortOrder;
  onSort: (order: SortOrder) => void;
  current: number;
  onJump: (index: number) => void;
  showHost: boolean;
  className?: string;
};

/** Search, filters, sort, and every comment grouped by page. A click scrolls the preview to it. */
export function Sidebar({ ordered, sections, numberOf, visible, filters, onFilters, sortOrder, onSort, current, onJump, showHost, className }: Props) {
  const shown = visible.filter(Boolean).length;
  const sevCounts: Record<string, number> = Object.fromEntries(SEVERITIES.map((s: { key: string }) => [s.key, ordered.filter((i) => severityOf(i.severity).key === s.key).length]));
  const statusCounts: Record<string, number> = Object.fromEntries(STATUSES.map((s: { key: string }) => [s.key, ordered.filter((i) => statusOf(i.status).key === s.key).length]));
  const statusesUsed = STATUSES.filter((s: { key: string }) => (statusCounts[s.key] ?? 0) > 0);
  const filtered = Boolean(filters.term || filters.severity !== 'all' || filters.status !== 'all');

  const set = (patch: Partial<Filters>) => onFilters(patch);

  return (
    <aside className={cn('flex min-h-0 flex-col bg-sidebar text-sidebar-foreground', className)} aria-label="Comments" data-tour="sidebar">
      <div className="grid gap-3 border-b border-sidebar-border p-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filters.term}
            onChange={(e) => set({ term: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.term) {
                e.preventDefault();
                set({ term: '' });
              }
            }}
            placeholder="Search comments"
            aria-label="Search comments"
            className="bg-background pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.term && (
            <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => set({ term: '' })} className="absolute top-1/2 right-1 -translate-y-1/2">
              <X />
            </Button>
          )}
        </div>
        {ordered.length > 0 && (
          <ToggleGroup value={[filters.severity]} onValueChange={(v) => v[0] && set({ severity: v[0] })} aria-label="Filter by severity" className="w-full">
            <ToggleGroupItem value="all" className="flex-1 px-2">
              All
            </ToggleGroupItem>
            {SEVERITIES.filter((s: { key: string }) => (sevCounts[s.key] ?? 0) > 0).map((s: { key: string; label: string }) => (
              <Tooltip key={s.key}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem value={s.key} aria-label={`${s.label}, ${sevCounts[s.key]}`} className="flex-1 px-2 tabular-nums">
                      <SeverityIcon severity={s.key} />
                      {sevCounts[s.key]}
                    </ToggleGroupItem>
                  }
                />
                <TooltipContent>{s.label}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
        )}
        {statusesUsed.length > 1 && (
          <ToggleGroup value={[filters.status]} onValueChange={(v) => v[0] && set({ status: v[0] })} aria-label="Filter by status" className="w-full">
            <ToggleGroupItem value="all" className="flex-1 px-2">
              Any
            </ToggleGroupItem>
            {statusesUsed.map((s: { key: string; label: string }) => (
              <ToggleGroupItem key={s.key} value={s.key} className="flex-1 px-2 tabular-nums">
                {s.label} {statusCounts[s.key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <div className="flex h-10 items-center justify-between gap-2 pr-2 pl-4">
        <span className="text-sm font-medium text-muted-foreground tabular-nums" aria-live="polite">
          {filtered ? `${shown} of ${ordered.length} shown` : `${ordered.length} ${ordered.length === 1 ? 'comment' : 'comments'}`}
        </span>
        {ordered.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
              <ArrowDownUp />
              {sortOrder === 'severity' ? 'By severity' : 'By number'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(['severity', 'number'] as const).map((order) => (
                <DropdownMenuItem key={order} onClick={() => onSort(order)}>
                  <Check className={cn(sortOrder !== order && 'invisible')} />
                  {order === 'severity' ? 'By severity' : 'By number'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div id="comments" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 outline-none">
        {ordered.length === 0 ? (
          <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
            <MessageSquareDashed aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-sm font-semibold">No comments yet</p>
            <p className="text-sm font-medium text-muted-foreground">Open the page you want to review, then click Margin in the toolbar to start.</p>
          </div>
        ) : shown === 0 ? (
          <div className="grid justify-items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm font-medium text-muted-foreground">{filters.term ? `No comments match "${filters.term.trim()}"` : 'No comments match these filters'}</p>
            <Button variant="outline" size="sm" onClick={() => onFilters(NO_FILTERS)}>
              Clear search and filters
            </Button>
          </div>
        ) : (
          <ul className="grid gap-px">
            {ordered.map((issue, index) => {
              if (!visible[index]) return null;
              const section = sections.find((s) => s.ids.has(issue.id));
              const first = section && ordered.findIndex((i, j) => visible[j] && section.ids.has(i.id)) === index;
              const status = statusOf(issue.status).key;
              const sub = [status !== 'open', Boolean(issue.jira?.key), showHost].some(Boolean);
              return (
                <li key={issue.id} className="contents">
                  {first && (
                    <p className="mt-3 flex items-baseline gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground first:mt-1" title={section.url}>
                      <span className="shrink-0">{section.label}</span>
                      <span className="min-w-0 flex-1 truncate">{section.route}</span>
                      <span className="tabular-nums">{[...section.ids].filter((id) => visible[ordered.findIndex((i) => i.id === id)]).length}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    aria-current={current === index}
                    ref={current === index ? (row) => row?.scrollIntoView({ block: 'nearest' }) : undefined}
                    onClick={() => onJump(index)}
                    className="grid w-full grid-cols-[20px_16px_minmax(0,1fr)] items-start gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-current:bg-sidebar-accent"
                  >
                    <span className="pt-px text-xs font-medium text-muted-foreground tabular-nums">{pad(numberOf(issue))}</span>
                    <span className="flex h-5 items-center justify-center">
                      <SeverityIcon severity={issue.severity} />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm font-medium">{issue.title || 'Untitled comment'}</span>
                      {sub && (
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
                          {status !== 'open' && <StatusLabel status={status} className="font-medium text-muted-foreground" />}
                          {issue.jira?.key && <span className="shrink-0">{issue.jira.key}</span>}
                          {showHost && <span className="truncate">{hostOf(issue.page?.url)}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
