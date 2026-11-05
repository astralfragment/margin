import { useQuery } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { HINT_SPACE } from '../page/geometry';
import { settingsQuery } from '../query';
import { useOverlay, overlayStore } from '../store';
import { useLayout } from './use-layout';

/** The annotation menu, opened by right-clicking the page, Shift+F10 or the menu key. */
export function PageMenu() {
  const menu = useOverlay((state) => state.menu);
  const settings = useQuery(settingsQuery).data;
  const { scale } = useLayout();
  const { closeMenu, captureElementAt, captureViewport, captureWidths, toggleSelectors, toggleMarkers, setActive } = overlayStore.getState();
  if (!menu) return null;
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }) };
  const edge = 8 * scale;
  const items: [string, () => void][] = [
    ['Comment on this element', () => captureElementAt(menu.x, menu.y)],
    ['Comment on the whole visible area', captureViewport],
    ['Capture comments on this page at three widths', () => void captureWidths({ page: true })],
    [settings?.selectorMode ? 'Turn selector capture off' : 'Turn selector capture on', toggleSelectors],
    [settings?.markerMode === false ? 'Turn numbered markers on' : 'Turn numbered markers off', toggleMarkers],
  ];
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && closeMenu()}>
      <DropdownMenuContent
        data-margin-float
        anchor={anchor}
        sideOffset={edge}
        alignOffset={6 * scale}
        collisionPadding={{ top: edge, right: edge, left: edge, bottom: HINT_SPACE * scale + edge }}
        className="w-[340px] max-w-[calc(100vw-16px)]"
      >
        {items.map(([label, run]) => (
          <DropdownMenuItem
            key={label}
            onClick={() => {
              closeMenu();
              run();
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            closeMenu();
            void setActive(false);
          }}
        >
          Stop annotating
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
