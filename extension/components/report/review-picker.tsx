import { useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Layers, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { ReviewSummary } from './queries';
import { plural } from './util';

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

type Option = { id: string; name: string; meta: string; count?: number; icon?: 'all' | 'new' };

type Props = {
  groups: ReviewSummary[];
  groupId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
};

/** Switches between reviews: a searchable list with each review's site, date and comment count. */
export function ReviewPicker({ groups, groupId, onPick, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const current = groups.find((g) => g.id === groupId);
  const total = groups.reduce((n, g) => n + (g.count ?? 0), 0);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const reviews = [...groups]
      .reverse()
      .filter((g) => !q || [g.name, ...g.sites].some((part) => part.toLowerCase().includes(q)))
      .map((g) => ({
        id: g.id,
        name: g.name,
        meta: [g.sites.length > 1 ? `${g.sites[0]} and ${g.sites.length - 1} more` : g.sites[0], g.createdAt && DAY.format(new Date(g.createdAt))].filter(Boolean).join(', '),
        count: g.count ?? 0,
      }));
    return [
      ...reviews,
      ...(!q || 'all reviews'.includes(q) ? [{ id: 'all', name: 'All reviews', meta: plural(groups.length, 'review', 'reviews'), count: total, icon: 'all' as const }] : []),
      { id: 'new', name: 'New review', meta: 'New comments go to it', icon: 'new' as const },
    ];
  }, [groups, query, total]);

  const choose = (option: Option) => {
    setOpen(false);
    if (option.id === 'new') onNew();
    else if (option.id !== (groupId ?? 'all')) onPick(option.id);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery('');
        setActive(0);
      }}
    >
      <PopoverTrigger
        data-tour="picker"
        render={<Button variant="ghost" className="h-8 max-w-64 min-w-0 gap-2 px-2 font-semibold" />}
        aria-label={`Review: ${current?.name ?? 'All reviews'}. Switch review`}
      >
        <span className="truncate">{current?.name ?? 'All reviews'}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="relative border-b">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={`${listId}-${active}`}
            aria-label="Find a review"
            placeholder="Find a review"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
              } else if (e.key === 'Enter' && options[active]) {
                e.preventDefault();
                choose(options[active]);
              }
            }}
            className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Reviews" className="max-h-80 overflow-y-auto p-1">
          {options.map((option, i) => {
            const selected = option.id === (groupId ?? 'all');
            return (
              <li
                key={option.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                data-active={i === active || undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(option)}
                className={cn(
                  'grid cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 data-active:bg-accent',
                  option.icon === 'all' && 'mt-1 border-t pt-2',
                )}
              >
                <span className="flex items-center justify-center text-muted-foreground">
                  {option.icon === 'all' ? <Layers className="size-4" /> : option.icon === 'new' ? <Plus className="size-4" /> : selected && <Check className="size-4 text-foreground" />}
                </span>
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">{option.name}</span>
                  {option.meta && <span className="truncate text-sm font-medium text-muted-foreground">{option.meta}</span>}
                </span>
                {option.count !== undefined && <span className="text-sm font-medium text-muted-foreground tabular-nums">{option.count}</span>}
              </li>
            );
          })}
          {options.length === 1 && <li className="px-2 py-3 text-center text-sm font-medium text-muted-foreground">No review matches "{query.trim()}"</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
