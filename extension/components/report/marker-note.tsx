import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { NoteAsk } from './store';
import { Popover, PopoverContent } from './ui/popover';

type Props = {
  ask: NoteAsk | null;
  onSave: (note: string) => void;
  onRemove: () => void;
  /** Closes without saving. A marker placed a moment ago is removed, so blank markers are never kept. */
  onDismiss: () => void;
};

/** A small box beside a marker placed or picked in the preview, asking for its note. */
export function MarkerNote({ ask, onSave, onRemove, onDismiss }: Props) {
  const point = ask?.at;
  const anchor = point ? { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) } : undefined;
  return (
    <Popover open={Boolean(ask)} onOpenChange={(open) => !open && onDismiss()}>
      <PopoverContent anchor={anchor} side="right" align="start" sideOffset={16} className="w-72 p-3" aria-label={ask ? `Note for marker ${ask.index + 1}` : undefined}>
        {ask && <NoteForm key={`${ask.issueId}-${ask.index}`} ask={ask} onSave={onSave} onRemove={onRemove} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The form for a marker's note.
 * @param props The marker and handlers.
 */
function NoteForm({ ask, onSave, onRemove }: { ask: NoteAsk; onSave: (note: string) => void; onRemove: () => void }) {
  const [value, setValue] = useState(ask.note);
  const [error, setError] = useState('');
  const save = () => {
    if (!value.trim()) return setError('Write a note, or remove the marker.');
    onSave(value.trim());
  };
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Note for marker {ask.index + 1}
        <Input
          autoFocus
          value={value}
          placeholder="What this number points out"
          aria-invalid={Boolean(error) || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
        />
      </label>
      {(error || ask.fresh) && <p className="text-sm font-medium text-muted-foreground">{error || 'A marker without a note is removed.'}</p>}
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRemove}>
          Remove marker
        </Button>
        <Button type="submit" size="sm">
          Save note
        </Button>
      </div>
    </form>
  );
}
