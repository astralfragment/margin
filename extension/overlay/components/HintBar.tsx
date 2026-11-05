import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { pageCommentsQuery, reviewQuery, settingsQuery } from '../query';
import { useOverlay, overlayStore } from '../store';
import { openReport } from '../store/composer';
import { useHintAtTop } from './use-hint-top';

const MARK_URL = `url("${chrome.runtime.getURL('/icons/ui/mark.svg')}")`;

/**
 * One of the bar's two switches, with its shortcut.
 * @param props The label, the key, whether it is on, what it does and its tooltip.
 */
function ModeSwitch({ label, shortcut, checked, onChange, title }: { label: string; shortcut: string; checked: boolean; onChange: () => void; title: string }) {
  return (
    <label title={title} className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-1 text-[13px] leading-[18px] hover:bg-muted">
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
      <Kbd className="max-sm:hidden">{shortcut}</Kbd>
    </label>
  );
}

/** The bar at the bottom of the view while annotating: the review, the two switches, and the ways to comment or stop. */
export function HintBar() {
  const review = useQuery(reviewQuery).data;
  const page = useQuery(pageCommentsQuery).data;
  const settings = useQuery(settingsQuery).data;
  const { reviewName, passing } = useOverlay(useShallow((state) => ({ reviewName: state.reviewName, passing: state.passing })));
  const { toggleSelectors, toggleMarkers, captureViewport, setActive } = overlayStore.getState();
  const atTop = useHintAtTop();
  const total = page?.total ?? 0;
  return (
    <div
      data-margin-float
      role="toolbar"
      aria-label="Margin annotation, Shift+F10 opens the actions menu"
      className={cn(
        'fixed left-1/2 flex h-10 max-w-[calc(100%-32px)] -translate-x-1/2 cursor-default items-center gap-3 overflow-hidden rounded-[10px] border bg-popover py-1 pr-1 pl-3 whitespace-nowrap text-popover-foreground shadow-md max-sm:gap-2',
        atTop ? 'top-4' : 'bottom-4',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <i className="h-[14.4px] w-[16.7px] shrink-0 bg-ink" style={{ maskImage: MARK_URL, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
        <b className="truncate font-semibold max-sm:hidden">{review?.name ?? (reviewName || 'Margin')}</b>
        <span className="text-[13px] leading-[18px] text-muted-foreground max-sm:hidden">
          {total ? `${total} ${total === 1 ? 'comment' : 'comments'}` : 'Drag over anything to comment'}
        </span>
      </span>
      <Separator orientation="vertical" className="h-5 max-sm:hidden" />
      <ModeSwitch
        label="Selectors"
        shortcut="S"
        checked={settings?.selectorMode ?? false}
        onChange={toggleSelectors}
        title={settings?.selectorMode ? 'Selector capture is on' : 'Selector capture is off'}
      />
      <ModeSwitch
        label="Markers"
        shortcut="M"
        checked={settings?.markerMode ?? true}
        onChange={toggleMarkers}
        title={settings?.markerMode ? 'Click inside a selection to add numbered markers' : 'Numbered markers are off'}
      />
      <Separator orientation="vertical" className="h-5 max-lg:hidden" />
      <span className={cn('flex shrink-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground max-lg:hidden', passing && 'text-ink')}>
        Hold <Kbd>Alt</Kbd> to use the page
      </span>
      <span className="flex shrink-0 items-center">
        <Button variant="ghost" title="Comment on the whole visible area" className="max-lg:hidden" onClick={captureViewport}>
          Visible area <Kbd>V</Kbd>
        </Button>
        <Button variant="ghost" className="max-sm:hidden" onClick={openReport}>
          Open report
        </Button>
        <Button variant="ghost" onClick={() => void setActive(false)}>
          Stop <Kbd className="max-sm:hidden">Esc</Kbd>
        </Button>
      </span>
    </div>
  );
}
