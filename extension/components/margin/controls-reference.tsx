import { Button } from '@/components/ui/button';
import { CONTROLS, openShortcutSettings } from '@/lib/controls.js';
import { Keys, useAnnotateShortcut } from './shortcut';

type Row = { keys?: string[]; gesture?: string; what: string };
type Group = { id: string; title: string; rows: Row[] };

/** Every key and gesture, with the start shortcut first. Used by the popup, the report and Help and settings. */
export function ControlsReference({ only }: { only?: string[] }) {
  const shortcut = useAnnotateShortcut();
  const groups = (CONTROLS as Group[]).filter((group) => !only || only.includes(group.id));
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div className="grid">
          <span className="text-sm font-semibold">Start and stop</span>
          <span className="text-xs text-muted-foreground">{shortcut ? 'Works on any page' : 'No shortcut yet. Pick one in Chrome.'}</span>
        </div>
        {shortcut ? (
          <Keys keys={shortcut} />
        ) : (
          <Button size="sm" variant="outline" onClick={openShortcutSettings}>
            Set shortcut
          </Button>
        )}
      </div>
      {groups.map((group) => (
        <section key={group.id} aria-label={group.title} className="grid gap-2">
          <h3 className="text-xs font-extrabold text-muted-foreground">{group.title}</h3>
          <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] gap-x-4 gap-y-2 text-sm">
            {group.rows.map((row) => (
              <div key={row.what} className="contents">
                <dt className="flex flex-wrap items-center gap-1.5 font-semibold text-muted-foreground">
                  {row.gesture}
                  {row.keys && <Keys keys={row.keys} />}
                </dt>
                <dd className="m-0">{row.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
