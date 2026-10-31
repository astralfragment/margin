import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { CircleHelp, FileText, Scan, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { ControlsReference } from '@/components/margin/controls-reference';
import { Keys } from '@/components/margin/shortcut';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { captureViewport, openReport, setActive, setMarkers, setPickElement, setPopover } from './controller';
import { Hint, PopoverContent, Switch } from './floating';
import { usePage, useSetting } from './queries';
import { useOverlay } from './store';

/** Margin's mark: a dashed region with a dot, drawn in the current text colour. */
function Mark() {
  return (
    <svg aria-hidden viewBox="0 0 16.7 14.4" className="h-[14px] w-4 shrink-0" fill="none">
      <rect x="0.7" y="4" width="12" height="9.6" rx="1.6" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 1.6" />
      <circle cx="13.1" cy="3.6" r="3.6" fill="var(--destructive)" />
    </svg>
  );
}

/** What the bar says under the review name: the comment count, how to start, or that the page has the pointer. */
function useStatus() {
  const { total, comments } = usePage();
  const passing = useOverlay((s) => s.passing);
  const card = useOverlay((s) => s.card && !s.card.reopened && s.card.id);
  const draftOpen = Boolean(card && comments.some((c) => c.id === card));
  if (passing) return 'Using the page. Let go of Alt to comment.';
  const n = Math.max(0, total - (draftOpen ? 1 : 0));
  return n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'Drag over anything to comment';
}

/**
 * One switch in the Options popover, with its shortcut.
 * @param props The setting, its label, detail, keys and state.
 */
function OptionRow({ id, label, detail, keys, checked, onChange }: { id: string; label: string; detail: string; keys: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid flex-1 gap-0.5">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold">
          {label}
          <Kbd>{keys}</Kbd>
        </label>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

/**
 * A capture bar button that opens a popover.
 * @param props Which popover, its label, icon and content.
 */
function BarPopover({ name, label, icon, children, className }: { name: 'options' | 'help'; label: string; icon: ReactNode; children: ReactNode; className?: string }) {
  const open = useOverlay((s) => s.popover === name);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => setPopover(next ? name : null)}>
      <Hint label={label}>
        <PopoverPrimitive.Trigger
          data-scope="popover-trigger"
          render={<Button variant="ghost" size="icon" aria-label={label} />}
        >
          {icon}
        </PopoverPrimitive.Trigger>
      </Hint>
      <PopoverContent aria-label={label} className={className}>
        {children}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

/** The Options popover for pick element and numbered markers. */
function Options() {
  const pickElement = useSetting('pickElement');
  const markers = useSetting('markers');
  return (
    <BarPopover name="options" label="Capture options" icon={<SlidersHorizontal />} className="grid w-80 gap-4">
      <OptionRow
        id="margin-pick"
        label="Pick element"
        keys="S"
        detail="Click an element to comment on it and record its selector."
        checked={pickElement}
        onChange={(on) => setPickElement(on)}
      />
      <OptionRow
        id="margin-markers"
        label="Numbered markers"
        keys="M"
        detail="Click inside an area to point at details."
        checked={markers}
        onChange={(on) => setMarkers(on)}
      />
      <Separator />
      <p className="text-xs leading-5 text-muted-foreground">
        Hold <Kbd className="mx-0.5">Alt</Kbd> to use the page, for example to open a menu.
      </p>
    </BarPopover>
  );
}

/** The Help popover with the keyboard controls. */
function Help() {
  return (
    <BarPopover name="help" label="Keys and gestures" icon={<CircleHelp />} className="max-h-(--available-height) w-96 overflow-y-auto">
      <ControlsReference only={['page']} />
    </BarPopover>
  );
}

/** The bar at the bottom of the page while annotating: the review, Visible area, Open report and Stop. */
export function CaptureBar() {
  const fallback = useOverlay((s) => s.reviewName);
  const name = usePage().review?.name ?? fallback;
  const atTop = useOverlay((s) => s.barAtTop);
  const passing = useOverlay((s) => s.passing);
  const status = useStatus();
  return (
    <div
      data-scope="bar"
      role="toolbar"
      aria-label="Margin. Shift+F10 opens the page menu."
      tabIndex={-1}
      className={cn(
        'fixed inset-x-0 mx-auto flex h-12 w-fit max-w-[calc(var(--vw)-32px)] items-center gap-1 rounded-xl bg-popover py-2 pr-2 pl-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none animate-in fade-in-0 duration-200',
        atTop ? 'top-4 slide-in-from-top-2' : 'bottom-4 slide-in-from-bottom-2',
      )}
    >
      <Mark />
      <div className="ml-2 grid min-w-0 max-sm:hidden">
        <span className="truncate text-sm leading-5 font-semibold">{name}</span>
        <span role="status" className={cn('truncate text-xs leading-4 text-muted-foreground', passing && 'text-foreground')}>
          {status}
        </span>
      </div>
      <Separator orientation="vertical" className="mx-3 h-6 self-center max-sm:hidden" />
      <Button variant="ghost" onClick={captureViewport} aria-label="Comment on the visible area">
        <Scan />
        <span className="max-md:hidden">Visible area</span>
        <Kbd className="max-lg:hidden">V</Kbd>
      </Button>
      <Button variant="ghost" onClick={openReport} aria-label="Open report">
        <FileText />
        <span className="max-md:hidden">Open report</span>
      </Button>
      <Options />
      <Help />
      <Separator orientation="vertical" className="mx-1 h-6 self-center" />
      <Button variant="ghost" onClick={() => setActive(false)}>
        Stop
        <Keys keys={['Esc']} className="max-lg:hidden" />
      </Button>
    </div>
  );
}
