import { Search } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { SEVERITIES, severityOf, STATUSES, statusOf } from './shared';
import { cn } from '@/lib/utils';
import type { CommentStatus, Severity } from '@/lib/model';
import { SeverityDot } from './badges';
import { clearFilters, useReportUi, type SortOrder } from './ui-store';
import { useReportComments } from './use-report';
import { hostOf, pad } from './format';
import { scrollToComment } from './comment-list';

/**
 * A row of filter chips where one is picked.
 * @param props.label What the row filters, for screen readers.
 * @param props.value The chip picked.
 * @param props.options Each chip's value and text.
 * @param props.onChange Called with the chip picked.
 */
function Chips<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: { value: Value; text: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => next[0] && onChange(next[0] as Value)}
      variant="outline"
      size="sm"
      spacing={1}
      className="flex-wrap"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="rounded-full px-2.5 text-xs aria-pressed:bg-foreground aria-pressed:text-background hover:aria-pressed:bg-foreground/85">
          {option.text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The search box, the sort order and the severity and status filters. Sits in the sidebar, or above the comments when narrow. */
export function FilterBar() {
  const { ordered } = useReportComments();
  const { search, sort, severity, status } = useReportUi();
  const severityCounts = SEVERITIES.map((sev) => ({ ...sev, count: ordered.filter((comment) => severityOf(comment.severity).key === sev.key).length }));
  const statusCounts = STATUSES.map((entry) => ({ ...entry, count: ordered.filter((comment) => statusOf(comment.status).key === entry.key).length })).filter(
    (entry) => entry.count > 0,
  );
  return (
    <div className="flex flex-col gap-2.5">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Search comments"
          aria-label="Search comments"
          value={search}
          onChange={(event) => useReportUi.setState({ search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search) {
              event.preventDefault();
              useReportUi.setState({ search: '' });
            }
          }}
        />
      </InputGroup>
      {ordered.length > 1 && (
        <Chips<SortOrder>
          label="Sort comments"
          value={sort}
          onChange={(next) => useReportUi.setState({ sort: next })}
          options={[
            { value: 'severity', text: 'By severity' },
            { value: 'number', text: 'By number' },
          ]}
        />
      )}
      {ordered.length > 0 && (
        <Chips<Severity | 'all'>
          label="Filter by severity"
          value={severity}
          onChange={(next) => useReportUi.setState({ severity: next })}
          options={[
            { value: 'all', text: `All ${ordered.length}` },
            ...severityCounts.filter((sev) => sev.count > 0).map((sev) => ({ value: sev.key, text: `${sev.label} ${sev.count}` })),
          ]}
        />
      )}
      {statusCounts.length > 1 && (
        <Chips<CommentStatus | 'all'>
          label="Filter by status"
          value={status}
          onChange={(next) => useReportUi.setState({ status: next })}
          options={[
            { value: 'all', text: 'Any status' },
            ...statusCounts.map((entry) => ({ value: entry.key, text: `${entry.label} ${entry.count}` })),
          ]}
        />
      )}
    </div>
  );
}

/** The comment index beside the report, which jumps to a comment and follows the scroll. */
export function Sidebar() {
  const { ordered, shown, numberOf } = useReportComments();
  const currentId = useReportUi((state) => state.currentId);
  const filtered = shown.length !== ordered.length;
  return (
    <aside className="hidden w-80 shrink-0 flex-col border-r md:flex" aria-label="Comment index" data-tour="sidebar">
      <div className="border-b p-3">
        <FilterBar />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Comments">
        {!ordered.length && (
          <p className="p-3 text-sm text-muted-foreground">No comments in this review yet. Open the page you want to review and press Alt+Shift+M to add one.</p>
        )}
        {ordered.length > 0 && !shown.length && (
          <div className="flex flex-col items-start gap-2 p-3 text-sm text-muted-foreground">
            <p>No comments match these filters</p>
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear search and filters
            </Button>
          </div>
        )}
        {shown.map((comment) => {
          const status = statusOf(comment.status);
          const number = pad(numberOf(comment));
          return (
            <button
              key={comment.id}
              type="button"
              aria-current={comment.id === currentId}
              title={`${number} ${comment.title || 'Untitled comment'}`}
              onClick={() => scrollToComment(comment.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                comment.id === currentId && 'bg-muted',
              )}
            >
              <span className="w-6 shrink-0 pt-px text-xs font-extrabold text-muted-foreground tabular-nums">{number}</span>
              <SeverityDot severity={comment.severity} className="mt-1.5" />
              <span className="flex min-w-0 flex-col">
                <b className="truncate font-semibold">{comment.title || 'Untitled comment'}</b>
                <span className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
                  {status.key !== 'open' && <span className={cn('shrink-0', status.key === 'fixed' && 'text-success')}>{status.label}</span>}
                  {comment.jira?.key && <span className="shrink-0">{comment.jira.key}</span>}
                  <span className="truncate">{hostOf(comment.page?.url)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {filtered ? `${shown.length} of ${ordered.length} comments shown` : `${ordered.length} ${ordered.length === 1 ? 'comment' : 'comments'}`}
      </div>
    </aside>
  );
}
