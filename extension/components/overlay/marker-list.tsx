import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeMark, setMarkNote } from './controller';
import { MarkerDot } from './marks';
import type { Mark } from './store';

/** A note field for each numbered marker, and the hint while the next one waits to be placed. */
export function MarkerList({ marks, placing }: { marks: Mark[]; placing: boolean }) {
  if (!marks.length && !placing) return null;
  return (
    <div className="grid gap-2">
      {marks.map((mark, i) => (
        <div key={i} className="flex items-center gap-2">
          <MarkerDot n={i + 1} className="ring-0" />
          <Input
            data-focus={`mark-${i}`}
            data-mark={i}
            value={mark.note}
            onChange={(e) => setMarkNote(i, e.target.value)}
            placeholder={`What marker ${i + 1} points out`}
            aria-label={`Note for marker ${i + 1}`}
            className="flex-1 text-sm md:text-sm"
          />
          <Button variant="ghost" size="icon-sm" aria-label={`Remove marker ${i + 1}`} onClick={() => removeMark(i, true)}>
            <X />
          </Button>
        </div>
      ))}
      {placing && (
        <p className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <MarkerDot n={marks.length + 1} ghost className="ring-0" />
          Click inside the area to place marker {marks.length + 1}
        </p>
      )}
    </div>
  );
}
