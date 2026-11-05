import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CameraIcon, FileTextIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { pageCommentsQuery, reviewQuery, settingsQuery } from '../query';
import { useOverlay, overlayStore } from '../store';
import { openReport } from '../store/composer';
import { MarginMark } from './MarginMark';
import { useHintAtTop } from './use-hint-top';

/**
 * An icon button in the bar, named by its tooltip.
 * @param props The tooltip text, its key, which side the tooltip opens on, the button and its icon.
 */
function BarButton({ label, shortcut, side, button, children }: { label: string; shortcut?: string; side: 'top' | 'bottom'; button: ReactElement; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={button} aria-label={label}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One of the option switches, with what it does and its key.
 * @param props The label, the line under it, the key, whether it is on and what it does.
 */
function OptionSwitch({ label, detail, shortcut, checked, onChange }: { label: string; detail: string; shortcut: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="grid flex-1 gap-0.5 whitespace-normal">
        <span className="font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <Kbd>{shortcut}</Kbd>
    </label>
  );
}

/**
 * The bar while annotating: the review and its count, icon buttons to comment on the visible area, open the report and
 * stop, and an options panel with the two switches and the Alt hint.
 */
export function HintBar() {
  const review = useQuery(reviewQuery).data;
  const page = useQuery(pageCommentsQuery).data;
  const settings = useQuery(settingsQuery).data;
  const { reviewName, passing } = useOverlay(useShallow((state) => ({ reviewName: state.reviewName, passing: state.passing })));
  const { toggleSelectors, toggleMarkers, captureViewport, setActive } = overlayStore.getState();
  const atTop = useHintAtTop();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const total = page?.total ?? 0;
  const side = atTop ? 'bottom' : 'top';
  const status = passing ? 'Using the page' : total ? `${total} ${total === 1 ? 'comment' : 'comments'}` : 'Drag to comment';
  return (
    <Collapsible
      open={optionsOpen}
      onOpenChange={setOptionsOpen}
      data-margin-float
      role="toolbar"
      aria-label="Margin annotation, Shift+F10 opens the actions menu"
      className={cn(
        'fixed left-1/2 flex w-(--margin-float-width) max-w-[calc(100%-32px)] -translate-x-1/2 cursor-default rounded-lg border bg-popover text-popover-foreground shadow-md',
        atTop ? 'top-4 flex-col' : 'bottom-4 flex-col-reverse',
      )}
    >
      <div className="flex h-10 items-center gap-2 pr-1 pl-3">
        <MarginMark className="h-[14.4px] w-[16.7px]" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2 whitespace-nowrap">
          <b className="truncate font-semibold">{review?.name ?? (reviewName || 'Margin')}</b>
          <span className={cn('truncate text-xs text-muted-foreground max-sm:hidden', passing && 'text-ink')}>{status}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <BarButton label="Comment on the visible area" shortcut="V" side={side} button={<Button variant="ghost" size="icon-sm" onClick={captureViewport} />}>
            <CameraIcon />
          </BarButton>
          <BarButton label="Open the report" side={side} button={<Button data-bar-report variant="ghost" size="icon-sm" onClick={openReport} />}>
            <FileTextIcon />
          </BarButton>
          <BarButton
            label={optionsOpen ? 'Hide options' : 'Options'}
            side={side}
            button={<Button data-bar-more variant="ghost" size="icon-sm" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)} />}
          >
            <SlidersHorizontalIcon />
          </BarButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <BarButton label="Stop annotating" shortcut="Esc Esc" side={side} button={<Button variant="ghost" size="icon-sm" onClick={() => void setActive(false)} />}>
            <XIcon />
          </BarButton>
        </span>
      </div>
      <CollapsibleContent className="w-0 min-w-full transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none">
        <div className={cn('grid gap-1 p-2', atTop ? 'border-t' : 'border-b')}>
          <OptionSwitch
            label="Pick elements"
            detail="Outline the element under the pointer and save its selector with the comment"
            shortcut="S"
            checked={settings?.selectorMode ?? false}
            onChange={toggleSelectors}
          />
          <OptionSwitch
            label="Numbered markers"
            detail="Click inside a commented area to drop numbered pins"
            shortcut="M"
            checked={settings?.markerMode ?? true}
            onChange={toggleMarkers}
          />
          <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            Hold <Kbd>Alt</Kbd> to click and scroll the page itself
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
