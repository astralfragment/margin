import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { resolveAccent } from '@/lib/theme.js';
import { cn } from '@/lib/utils';
import { CaptureBar } from './capture-bar';
import { Composer } from './composer';
import { onSheetContext, onSheetDown } from './controller';
import { PortalProvider } from './floating';
import { PageMenu } from './page-menu';
import { useSetting } from './queries';
import { SavedRegions } from './saved-regions';
import { Selection } from './selection';
import { useOverlay } from './store';
import { Toasts } from './toasts';

const DARK = '(prefers-color-scheme: dark)';

const onEvent = (target: EventTarget, type: string) => (change: () => void) => {
  target.addEventListener(type, change);
  return () => target.removeEventListener(type, change);
};

const subscribeDark = (change: () => void) => onEvent(matchMedia(DARK), 'change')(change);
const subscribeResize = onEvent(window, 'resize');

/**
 * The surface over the page while annotating. It leaves the page exactly as it looks, with only a thin accent frame
 * at the edge of the view and a crosshair, and takes presses to draw, mark or open the page menu.
 */
function Sheet() {
  const passing = useOverlay((s) => s.passing);
  return (
    <div
      data-sheet=""
      onMouseDown={(e) => onSheetDown(e.nativeEvent)}
      onContextMenu={(e) => onSheetContext(e.nativeEvent)}
      className={cn('absolute inset-0 cursor-crosshair shadow-[inset_0_0_0_2px_var(--action)] transition-shadow duration-150', passing && 'shadow-none')}
    />
  );
}

/** Everything Margin draws on a page, themed and isolated inside the shadow root. */
export function Overlay() {
  const active = useOverlay((s) => s.active);
  const capturing = useOverlay((s) => s.capturing);
  const scale = useOverlay((s) => s.scale);
  const choice = useSetting('theme');
  const accent = resolveAccent(useSetting('accent'));
  const systemDark = useSyncExternalStore(subscribeDark, () => matchMedia(DARK).matches);
  const width = useSyncExternalStore(subscribeResize, () => innerWidth);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  if (!active) return null;
  const dark = choice === 'dark' || (choice !== 'light' && systemDark);
  return (
    <div
      data-theme={dark ? 'dark' : 'light'}
      data-accent={accent}
      style={{ '--vw': `${width / scale}px` } as CSSProperties}
      className={cn('fixed inset-0 font-sans text-sm font-medium text-foreground tabular-nums antialiased', capturing && 'cursor-progress')}
    >
      <PortalProvider value={portal}>
        <Sheet />
        <SavedRegions />
        <Selection />
        <Composer />
        <CaptureBar />
        <PageMenu />
        <Toasts />
      </PortalProvider>
      <div ref={setPortal} />
    </div>
  );
}
