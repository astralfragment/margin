import type { KeyboardEvent } from 'react';
import { SeverityIcon, type SeverityKey } from '@/components/margin/severity';
import { SEVERITIES } from '@/lib/severity.js';
import { cn } from '@/lib/utils';

const KEYS = SEVERITIES.map((s) => s.key) as SeverityKey[];

/** Severity as a segmented control. Arrow keys move and pick, as in a radio group, and 1 to 4 pick from anywhere. */
export function SeverityPicker({ value, onChange }: { value: SeverityKey; onChange: (key: SeverityKey) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = KEYS[(KEYS.indexOf(value) + step + KEYS.length) % KEYS.length] ?? value;
    onChange(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-severity="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Severity" onKeyDown={onKeyDown} className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-0.5">
      {SEVERITIES.map((s, i) => {
        const checked = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-severity={s.key}
            title={`${s.label}, key ${i + 1}`}
            onClick={() => onChange(s.key as SeverityKey)}
            className={cn(
              'flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
              checked && 'bg-background text-foreground shadow-sm ring-1 ring-foreground/10 hover:text-foreground',
            )}
          >
            <SeverityIcon severity={s.key} className={cn(!checked && 'opacity-60')} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
