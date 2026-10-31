import type { ReactNode } from 'react';

type Props = { title: string; back: ReactNode; footer?: ReactNode; onEscape: () => void; children: ReactNode };

/** A full popup view that slides in over the home view: a header with a way back, a scrolling body and a footer. */
export function Panel({ title, back, footer, onEscape, children }: Props) {
  return (
    <section
      aria-labelledby="panel-title"
      className="flex max-h-[inherit] min-h-0 flex-col animate-in fade-in-0 slide-in-from-right-3 duration-150 motion-reduce:animate-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onEscape();
        }
      }}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        {back}
        <h1 id="panel-title" className="text-sm font-semibold">
          {title}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer && <footer className="shrink-0 border-t px-4 py-3">{footer}</footer>}
    </section>
  );
}
