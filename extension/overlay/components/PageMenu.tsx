import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CameraIcon, MonitorSmartphoneIcon, MousePointerClickIcon, PinIcon, SquareDashedMousePointerIcon, XIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { HINT_SPACE } from '../page/geometry';
import { settingsQuery } from '../query';
import { useOverlay, overlayStore } from '../store';
import { MarginMark } from './MarginMark';
import { useLayout } from './use-layout';

/**
 * A menu item that closes the menu, then runs.
 * @param props The icon, the words, the key and what it does.
 */
function MenuAction({ icon, shortcut, run, children }: { icon: ReactNode; shortcut?: string; run: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem
      onClick={() => {
        overlayStore.getState().closeMenu();
        run();
      }}
    >
      {icon}
      {children}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

/**
 * An option in the menu that stays open when picked and shows on or off as a switch at the row's end, where the other
 * rows keep their keys.
 * @param props The icon, the words, whether it is on and what flips it.
 */
function MenuOption({ icon, checked, onChange, children }: { icon: ReactNode; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <DropdownMenuCheckboxItem checked={checked} onCheckedChange={onChange} className="pr-2 *:data-[slot=dropdown-menu-checkbox-item-indicator]:hidden">
      {icon}
      {children}
      <Switch size="sm" checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto" />
    </DropdownMenuCheckboxItem>
  );
}

/** Margin's own menu, opened by right-clicking the page, Shift+F10 or the menu key while annotating. */
export function PageMenu() {
  const menu = useOverlay((state) => state.menu);
  const settings = useQuery(settingsQuery).data;
  const { scale } = useLayout();
  const { captureElementAt, captureViewport, captureWidths, toggleSelectors, toggleMarkers, setActive } = overlayStore.getState();
  if (!menu) return null;
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }) };
  const edge = 8 * scale;
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && overlayStore.getState().closeMenu()}>
      <DropdownMenuContent
        data-margin-float
        aria-label="Margin"
        anchor={anchor}
        sideOffset={edge}
        alignOffset={6 * scale}
        collisionPadding={{ top: edge, right: edge, left: edge, bottom: HINT_SPACE * scale + edge }}
        className="w-80 max-w-[calc(100vw-16px)]"
      >
        <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
          <MarginMark className="h-3 w-[14px]" />
          <span className="text-xs font-semibold">Margin</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Comment</DropdownMenuLabel>
          <MenuAction icon={<MousePointerClickIcon />} run={() => captureElementAt(menu.x, menu.y)}>
            Comment on this element
          </MenuAction>
          <MenuAction icon={<CameraIcon />} shortcut="V" run={captureViewport}>
            Comment on the visible area
          </MenuAction>
          <MenuAction icon={<MonitorSmartphoneIcon />} run={() => void captureWidths({ page: true })}>
            Screenshot comments at 3 screen sizes
          </MenuAction>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Options</DropdownMenuLabel>
          <MenuOption icon={<SquareDashedMousePointerIcon />} checked={settings?.selectorMode ?? false} onChange={toggleSelectors}>
            Pick elements
          </MenuOption>
          <MenuOption icon={<PinIcon />} checked={settings?.markerMode ?? true} onChange={toggleMarkers}>
            Numbered markers
          </MenuOption>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <MenuAction icon={<XIcon />} shortcut="Esc Esc" run={() => void setActive(false)}>
          Stop annotating
        </MenuAction>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
