import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Columns3, MapPin, MousePointer2, MousePointerClick, Scan, Square } from 'lucide-react';
import { useMemo } from 'react';
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { BAR_SPACE } from './geometry';
import { captureViewport, captureWidthsOnPage, closeMenu, menuActions, setMarkers, setPickElement } from './controller';
import { MenuContent } from './floating';
import { useSetting } from './queries';
import { useOverlay } from './store';

/**
 * The menu a right-click, Shift+F10 or the menu key opens on the page. It opens under the element it outlines when
 * that element is small and there is room, else at the pointer, and always clear of the capture bar.
 */
export function PageMenu() {
  const menu = useOverlay((s) => s.menu);
  const pickElement = useSetting('pickElement');
  const markers = useSetting('markers');
  const scale = useOverlay((s) => s.scale);
  const barAtTop = useOverlay((s) => s.barAtTop);
  const anchor = useMemo(() => {
    if (!menu) return null;
    const { x, y, target } = menu;
    const below = target && target.h < innerHeight / 3 && target.y + target.h + 6 * scale + 240 * scale <= innerHeight - BAR_SPACE * scale;
    const left = x + 6 * scale;
    const top = below ? target.y + target.h + 6 * scale : y + 8 * scale;
    return { getBoundingClientRect: () => DOMRect.fromRect({ x: left, y: top, width: 0, height: 0 }) };
  }, [menu, scale]);
  const run = (action: () => void) => () => {
    closeMenu();
    action();
  };
  return (
    <MenuPrimitive.Root open={Boolean(menu)} onOpenChange={(open) => !open && closeMenu()} modal={false}>
      <MenuContent
        anchor={anchor}
        sideOffset={0}
        collisionPadding={{ top: 8, left: 8, right: 8, bottom: barAtTop ? 8 : BAR_SPACE }}
        aria-label="Margin"
        className="w-72"
      >
        <DropdownMenuItem onClick={run(() => menu && menuActions.element(menu.x, menu.y))}>
          <MousePointerClick />
          Comment on this element
        </DropdownMenuItem>
        <DropdownMenuItem onClick={run(captureViewport)}>
          <Scan />
          Comment on the visible area
          <DropdownMenuShortcut>V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={run(captureWidthsOnPage)}>
          <Columns3 />
          Capture this page at three widths
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={pickElement} onCheckedChange={(on) => setPickElement(on)}>
          <MousePointer2 />
          Pick element
          <DropdownMenuShortcut className="mr-1">S</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={markers} onCheckedChange={(on) => setMarkers(on)}>
          <MapPin />
          Numbered markers
          <DropdownMenuShortcut className="mr-1">M</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={run(menuActions.stop)}>
          <Square />
          Stop annotating
          <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
        </DropdownMenuItem>
      </MenuContent>
    </MenuPrimitive.Root>
  );
}
