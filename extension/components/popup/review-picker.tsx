import { useRef, useState } from 'react';
import { ChevronsUpDown, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { Group } from './model';

const NAME_MAX = 120;

type Props = {
  groups: Group[];
  counts: Map<string, number>;
  /** The review the popup shows, or null when it offers to start one. */
  current: Group | null;
  title: string;
  subtitle: string;
  renaming: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
  onRenameStart: () => void;
  onRename: (name: string | null) => void;
};

/** The review name with a menu to switch reviews, rename this one or start another. Renames in place. */
export function ReviewPicker({ groups, counts, current, title, subtitle, renaming, onPick, onNew, onRenameStart, onRename }: Props) {
  if (renaming && current) return <RenameField name={current.name} onDone={onRename} />;
  const heading = (
    <span className="grid min-w-0 text-left">
      <span className="truncate text-sm font-semibold">{title}</span>
      {subtitle && <span className="truncate text-xs font-medium text-muted-foreground">{subtitle}</span>}
    </span>
  );
  if (!groups.length) return <div className="min-w-0 flex-1 px-2">{heading}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour="picker"
        render={<Button variant="ghost" className="h-auto min-w-0 flex-1 justify-between gap-2 px-2 py-1" title={title} />}
      >
        {heading}
        <ChevronsUpDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-h-80">
        <DropdownMenuRadioGroup value={current?.id ?? ''} onValueChange={(id) => onPick(id as string)}>
          {groups
            .slice()
            .reverse()
            .map((group) => (
              <DropdownMenuRadioItem key={group.id} value={group.id} title={group.name} className="py-2">
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{counts.get(group.id) ?? 0}</span>
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {current && (
          <DropdownMenuItem onClick={onRenameStart}>
            <Pencil />
            Rename this review
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onNew}>
          <Plus />
          New review
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The review name as an input. Enter or leaving the field saves, Escape keeps the old name. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next && next.trim() && next.trim() !== name ? next.trim() : null);
  };
  return (
    <Input
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      aria-label="Review name"
      maxLength={NAME_MAX}
      value={value}
      className="h-9 min-w-0 flex-1 text-sm font-semibold"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}
