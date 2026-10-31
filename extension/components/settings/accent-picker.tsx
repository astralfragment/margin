import { useRef, type KeyboardEvent } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ACCENTS } from '@/lib/theme.js';
import { cn } from '@/lib/utils';

type Props = { value: string; onChange: (key: string) => void; labelledBy: string };

/** Round swatches that act as one radio group: Tab reaches the chosen one, arrow keys move and choose. */
export function AccentPicker({ value, onChange, labelledBy }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, ACCENTS.findIndex((accent) => accent.key === value));

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (current + step + ACCENTS.length) % ACCENTS.length;
    onChange(ACCENTS[next]!.key);
    refs.current[next]?.focus();
  };

  return (
    <TooltipProvider delay={300}>
      <div role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="flex items-center gap-2">
        {ACCENTS.map((accent, i) => {
          const checked = i === current;
          return (
            <Tooltip key={accent.key}>
              <TooltipTrigger
                render={
                  <button
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={accent.label}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => onChange(accent.key)}
                    className={cn(
                      'size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      checked ? 'ring-2 ring-foreground' : 'ring-1 ring-border hover:ring-2 hover:ring-muted-foreground',
                      // Black and white shows as the text colour, so it reads in both themes.
                      accent.key === 'neutral' && 'bg-foreground',
                    )}
                    style={accent.key === 'neutral' ? undefined : { background: accent.swatch }}
                  />
                }
              />
              <TooltipContent>{accent.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
