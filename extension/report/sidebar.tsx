import { ArrowDownUp, Hash, Search, TriangleAlert, X } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SEVERITIES, severityOf, STATUSES, statusOf } from './shared';
import { cn } from '@/lib/utils';
import type { CommentStatus, Severity } from '@/lib/model';
import { SeverityDot, STATUS_ICONS } from './badges';
import { clearFilters, useReportUi, type SortOrder } from './ui-store';
import { useReportComments } from './use-report';
import { hostOf, pad } from './format';
import { scrollToComment } from './comment-list';
import { SelectAllShown, setSelected, useCommentEdit } from './edit-comments';

const SORT_LABELS: Record<SortOrder, string> = { severity: 'Severity first', number: 'In order added' };

/** The sort order of the comments, as a small menu that names the order in use. */
export function SortMenu() {
  const sort = useReportUi((state) => state.sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}>
        <ArrowDownUp />
        {SORT_LABELS[sort]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort comments</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(next) => useReportUi.setState({ sort: next as SortOrder })}>
            <DropdownMenuRadioItem value="severity">
              <TriangleAlert />
              {SORT_LABELS.severity}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="number">
              <Hash />
              {SORT_LABELS.number}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The search box and the severity and status filters. Sits in the sidebar, or above the comments when narrow. */
export function FilterBar() {
  const { ordered } = useReportComments();
  const { search, severity, status } = useReportUi();
  const severityCount = (key: Severity) => ordered.filter((comment) => severityOf(comment.severity).key === key).length;
  const statusCount = (key: CommentStatus) => ordered.filter((comment) => statusOf(comment.status).key === key).length;
  const severityItems = [{ value: 'all', label: 'All severities' }, ...SEVERITIES.map((sev) => ({ value: sev.key, label: sev.label }))];
  const statusItems = [{ value: 'all', label: 'Any status' }, ...STATUSES.map((entry) => ({ value: entry.key, label: entry.label }))];
  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Search comments"
          aria-label="Search comments"
          className="[&::-webkit-search-cancel-button]:appearance-none"
          value={search}
          onChange={(event) => useReportUi.setState({ search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search) {
              event.preventDefault();
              useReportUi.setState({ search: '' });
            }
          }}
        />
        {search && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => useReportUi.setState({ search: '' })}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <div className="grid grid-cols-2 gap-2">
        <Select items={severityItems} value={severity} onValueChange={(next) => next && useReportUi.setState({ severity: next as Severity | 'all' })}>
          <SelectTrigger size="sm" aria-label="Show severity" className={cn('w-full', severity !== 'all' && 'border-foreground/40 bg-muted')}>
            {severity !== 'all' && <SeverityDot severity={severity} />}
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start" className="w-52">
            <SelectItem value="all">
              All severities
              <span className="ml-auto self-center pl-4 text-xs text-muted-foreground tabular-nums">{ordered.length}</span>
            </SelectItem>
            {SEVERITIES.map((sev) => (
              <SelectItem key={sev.key} value={sev.key}>
                <SeverityDot severity={sev.key} className="self-center" />
                {sev.label}
                <span className="ml-auto self-center pl-4 text-xs text-muted-foreground tabular-nums">{severityCount(sev.key)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={statusItems} value={status} onValueChange={(next) => next && useReportUi.setState({ status: next as CommentStatus | 'all' })}>
          <SelectTrigger size="sm" aria-label="Show status" className={cn('w-full', status !== 'all' && 'border-foreground/40 bg-muted')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start" className="w-52">
            <SelectItem value="all">
              Any status
              <span className="ml-auto self-center pl-4 text-xs text-muted-foreground tabular-nums">{ordered.length}</span>
            </SelectItem>
            {STATUSES.map((entry) => {
              const Icon = STATUS_ICONS[entry.key];
              return (
                <SelectItem key={entry.key} value={entry.key}>
                  <Icon />
                  {entry.label}
                  <span className="ml-auto self-center pl-4 text-xs text-muted-foreground tabular-nums">{statusCount(entry.key)}</span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** How many comments show, a way back when filters hide some, the select all box and the sort order. */
export function ListHeader({ className }: { className?: string }) {
  const { ordered, shown } = useReportComments();
  const { search, severity, status } = useReportUi();
  const filtered = Boolean(search.trim()) || severity !== 'all' || status !== 'all';
  return (
    <div className={cn('flex min-h-7 items-center gap-2 text-xs text-muted-foreground', className)}>
      {ordered.length > 0 && <SelectAllShown />}
      <span className="font-medium whitespace-nowrap">{filtered ? `${shown.length} of ${ordered.length} shown` : `${ordered.length} ${ordered.length === 1 ? 'comment' : 'comments'}`}</span>
      {filtered && (
        <Button variant="link" size="xs" className="px-0 text-xs" onClick={clearFilters}>
          Clear
        </Button>
      )}
      <span className="flex-1" />
      {ordered.length > 1 && <SortMenu />}
    </div>
  );
}

/** The comment index beside the report, which jumps to a comment and follows the scroll. */
export function Sidebar() {
  const { ordered, shown, numberOf } = useReportComments();
  const currentId = useReportUi((state) => state.currentId);
  const selected = useCommentEdit((state) => state.selected);
  return (
    <aside className="hidden w-80 shrink-0 flex-col border-r md:flex" aria-label="Comment index" data-tour="sidebar">
      <div className="flex flex-col gap-3 border-b p-4">
        <FilterBar />
        <ListHeader />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Comments">
        {!ordered.length && (
          <p className="p-2 text-sm text-muted-foreground">No comments in this review yet. Open the page you want to review and press Alt+Shift+M to add one.</p>
        )}
        {ordered.length > 0 && !shown.length && <p className="p-2 text-sm text-muted-foreground">No comments match these filters.</p>}
        {shown.map((comment) => {
          const status = statusOf(comment.status);
          const number = pad(numberOf(comment));
          const isSelected = selected.includes(comment.id);
          return (
            <div
              key={comment.id}
              className={cn('flex items-start gap-2 rounded-md px-2 hover:bg-muted', comment.id === currentId && 'bg-muted', isSelected && 'bg-muted')}
            >
              <Checkbox className="mt-2.5" checked={isSelected} onCheckedChange={(on) => setSelected(comment.id, on)} aria-label={`Select comment ${number}`} />
              <button
                type="button"
                aria-current={comment.id === currentId}
                title={`${number} ${comment.title || 'Untitled comment'}`}
                onClick={() => scrollToComment(comment.id)}
                className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="w-5 shrink-0 pt-px text-xs font-extrabold text-muted-foreground tabular-nums">{number}</span>
                <SeverityDot severity={comment.severity} className="mt-1.5" />
                <span className="flex min-w-0 flex-col">
                  <b className="truncate font-semibold">{comment.title || 'Untitled comment'}</b>
                  <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
                    {status.key !== 'open' && <span className={cn('shrink-0', status.key === 'fixed' && 'text-fixed')}>{status.label}</span>}
                    {comment.jira?.key && <span className="shrink-0">{comment.jira.key}</span>}
                    <span className="truncate">{hostOf(comment.page?.url)}</span>
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
