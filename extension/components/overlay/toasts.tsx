import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { holdToast, openReport, pad, undoSave } from './controller';
import { BAR_SPACE, EDGE } from './geometry';
import { useOverlay, type Toast } from './store';

const SURFACE = 'fixed flex items-center rounded-lg bg-foreground text-sm font-medium text-background shadow-lg animate-in fade-in-0 duration-150';

/** Confirms a saved comment where the composer was, with Edit to reopen it and Open report. Focus moves to Edit. */
function SavedToast({ toast }: { toast: Extract<Toast, { kind: 'saved' }> }) {
  const scale = useOverlay((s) => s.scale);
  /** Measures the toast once it is drawn and sets it where the composer was, above the capture bar. */
  const place = (node: HTMLDivElement | null) => {
    if (!node) return;
    const w = node.offsetWidth * scale;
    const h = node.offsetHeight * scale;
    const left = Math.min(Math.max(EDGE * scale, toast.box.left), innerWidth - w - EDGE * scale);
    node.style.left = `${left / scale}px`;
    node.style.top = `${(Math.min(toast.box.bottom, innerHeight - BAR_SPACE * scale) - h) / scale}px`;
  };
  return (
    <div
      ref={place}
      data-scope="toast"
      role="status"
      className={cn(SURFACE, 'h-10 gap-2 py-1 pr-1 pl-4 zoom-in-95')}
      onMouseEnter={() => holdToast(0)}
      onMouseLeave={() => holdToast(2500)}
    >
      <span className="pr-2">Comment {pad(toast.number)} saved</span>
      <Button ref={(el: HTMLButtonElement | null) => el?.focus({ preventScroll: true })} size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={undoSave}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={openReport}>
        Open report
      </Button>
    </div>
  );
}

/** A short message just above the capture bar, or below it while the bar sits at the top. */
function PlainToast({ toast }: { toast: Extract<Toast, { kind: 'plain' }> }) {
  const atTop = useOverlay((s) => s.barAtTop);
  return (
    <div
      role="status"
      className={cn(SURFACE, 'left-1/2 max-w-[calc(var(--vw)-32px)] -translate-x-1/2 px-4 py-2.5 leading-5', atTop ? 'top-18 slide-in-from-top-1' : 'bottom-18 slide-in-from-bottom-1')}
    >
      {toast.text}
    </div>
  );
}

export function Toasts() {
  const toast = useOverlay((s) => s.toast);
  if (!toast) return null;
  return toast.kind === 'saved' ? <SavedToast key={toast.id} toast={toast} /> : <PlainToast key={toast.id} toast={toast} />;
}
