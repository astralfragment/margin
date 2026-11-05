import { useCallback, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHotkeys } from 'react-hotkeys-hook';
import { useShallow } from 'zustand/react/shallow';
import type { Severity, ThemeChoice } from '@/lib/model';
import { PortalContainerContext } from '@/components/portal-container';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HINT_SPACE } from '../page/geometry';
import { currentHost } from '../page/host';
import { isEditable } from '../page/pick';
import { settingsQuery } from '../query';
import { useOverlay, overlayStore } from '../store';
import Composer from './Composer';
import { HintBar } from './HintBar';
import { AreaBand, HoverOutline, SavedComments } from './PageLayer';
import { PageMenu } from './PageMenu';
import { useHintAtTop } from './use-hint-top';

const SEVERITY_KEYS: Severity[] = ['blocker', 'major', 'minor', 'nit'];
/** Toasts sit just past the bar and, on a narrow screen, keep the bar's 16px side margins so their edges line up. */
const TOAST_OFFSET = { top: HINT_SPACE + 4, bottom: HINT_SPACE + 4, left: 16, right: 16 };
const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Subscribes to the system switching between light and dark, for useSyncExternalStore.
 * @param listener Called on each switch.
 */
function subscribeSystemTheme(listener: () => void) {
  systemDark.addEventListener('change', listener);
  return () => systemDark.removeEventListener('change', listener);
}

/**
 * True when the overlay should be dark: the setting says dark, or it follows a system set to dark.
 * @param theme The theme setting.
 */
function useDark(theme: ThemeChoice) {
  const systemIsDark = useSyncExternalStore(subscribeSystemTheme, () => systemDark.matches);
  return theme === 'dark' || (theme === 'system' && systemIsDark);
}

/**
 * The overlay's single-key shortcuts, on its root: S and M flip the switches and V comments on the visible area, and
 * with a card open 1 to 4 pick a severity, R redraws and Ctrl+Z takes back the last marker change. They never fire
 * while typing in a field. Returns the ref that attaches them.
 */
function useShortcuts() {
  const { open, menu, pending, asking } = useOverlay(
    useShallow((state) => ({ open: Boolean(state.card), menu: Boolean(state.menu), pending: Boolean(state.pending), asking: Boolean(state.card?.asking) })),
  );

  const idle = !open && !menu;
  const selectors = useHotkeys('s', () => overlayStore.getState().toggleSelectors(), { enabled: idle, preventDefault: true });
  const markers = useHotkeys('m', () => overlayStore.getState().toggleMarkers(), { enabled: idle, preventDefault: true });
  const viewport = useHotkeys('v', () => overlayStore.getState().captureViewport(), { enabled: idle && !pending, preventDefault: true });
  const severity = useHotkeys(['1', '2', '3', '4'], (event) => overlayStore.getState().editCard({ severity: SEVERITY_KEYS[Number(event.key) - 1] }), { enabled: open, preventDefault: true });
  const redraw = useHotkeys('r', () => overlayStore.getState().redraw(), { enabled: open && !asking, preventDefault: true });
  const undo = useHotkeys(
    'mod+z',
    (event) => {
      const focused = currentHost()?.shadow.activeElement;
      const lastNote = `[data-marker-note="${overlayStore.getState().markers.length - 1}"]`;
      const emptyLastNote = focused instanceof HTMLTextAreaElement && focused.matches(lastNote) && !focused.value;
      if (isEditable(focused) && !emptyLastNote) return;
      if (!overlayStore.getState().undoMarker()) return;
      event.preventDefault();
      currentHost()?.shadow.querySelector<HTMLElement>('[data-card-title]')?.focus();
    },
    { enabled: open, enableOnFormTags: true },
  );
  return useCallback(
    (element: HTMLDivElement | null) => {
      const cleanups = [selectors, markers, viewport, severity, redraw, undo].map((attach) => attach(element));
      if (element) currentHost()?.setRoot(element);
      return () => cleanups.forEach((cleanup) => typeof cleanup === 'function' && cleanup());
    },
    [selectors, markers, viewport, severity, redraw, undo],
  );
}

/** The whole overlay: the tinted cover that takes presses, the page markings, the bar, the menu, the card and toasts. */
export function App() {
  const active = useOverlay((state) => state.active);
  const theme = useQuery(settingsQuery).data?.theme ?? 'system';
  const dark = useDark(theme);
  const rootRef = useShortcuts();
  const hintTop = useHintAtTop();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const { pointerDown, pointerMove, pointerUp, contextMenu } = overlayStore.getState();
  return (
    <div
      ref={rootRef}
      data-margin
      data-theme={dark ? 'dark' : 'light'}
      tabIndex={-1}
      hidden={!active}
      className="fixed inset-0 cursor-crosshair bg-[rgb(13_10_23/0.12)] shadow-[inset_0_0_0_2px_var(--ink)] outline-none"
      onMouseDown={(event) => pointerDown(event.nativeEvent)}
      onMouseMove={(event) => pointerMove(event.nativeEvent)}
      onMouseUp={(event) => pointerUp(event.nativeEvent)}
      onContextMenu={(event) => contextMenu(event.nativeEvent)}
    >
      <PortalContainerContext.Provider value={portal}>
        <TooltipProvider delay={150}>
          {active && (
            <>
              <SavedComments />
              <HoverOutline />
              <AreaBand />
              <HintBar />
              <PageMenu />
              <Composer />
            </>
          )}
          <Toaster
            theme={dark ? 'dark' : 'light'}
            position={hintTop ? 'top-center' : 'bottom-center'}
            offset={TOAST_OFFSET}
            mobileOffset={TOAST_OFFSET}
            visibleToasts={3}
          />
          <div ref={setPortal} className="contents" />
        </TooltipProvider>
      </PortalContainerContext.Provider>
    </div>
  );
}
