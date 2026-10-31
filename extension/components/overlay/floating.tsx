import { createContext, useContext, type ReactNode } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '@/lib/utils';

/**
 * Base UI portals popups to document.body, outside the shadow root, where the page's styles would reach them and
 * Margin's would not. These wrappers follow shadcn's base-nova popover, menu, switch and tooltip, with the portal
 * pointed at a container inside the shadow root.
 */
const PortalContext = createContext<HTMLElement | null>(null);

export const PortalProvider = PortalContext.Provider;

const usePortal = () => useContext(PortalContext);

const POPUP =
  'z-50 origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

type Placement = Pick<PopoverPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset' | 'collisionPadding' | 'anchor'>;

export function PopoverContent({ className, side = 'top', align = 'center', sideOffset = 8, ...props }: PopoverPrimitive.Popup.Props & Placement) {
  return (
    <PopoverPrimitive.Portal container={usePortal()}>
      <PopoverPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} className="isolate z-50">
        <PopoverPrimitive.Popup data-scope="popover" className={cn(POPUP, 'p-4', className)} {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export function MenuContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  alignOffset = 0,
  collisionPadding = 8,
  anchor,
  ...props
}: MenuPrimitive.Popup.Props & Placement) {
  return (
    <MenuPrimitive.Portal container={usePortal()}>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className="isolate z-50 outline-none"
      >
        <MenuPrimitive.Popup data-scope="menu" className={cn(POPUP, 'min-w-56 p-1', className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-md border border-transparent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary data-unchecked:bg-input/50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-sm bg-background shadow-sm transition-transform data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground" />
    </SwitchPrimitive.Root>
  );
}

/**
 * A tooltip for an icon button, naming what it does and its key. It opens on hover only: the button's label already
 * names it for keyboard use, and focus coming back after a popover closes should not bring up a tooltip.
 */
export function Hint({ label, keys, children }: { label: string; keys?: ReactNode; children: TooltipPrimitive.Trigger.Props['render'] }) {
  return (
    <TooltipPrimitive.Root onOpenChange={(open, details) => open && details.reason === 'trigger-focus' && details.cancel()}>
      <TooltipPrimitive.Trigger delay={400} render={children} />
      <TooltipPrimitive.Portal container={usePortal()}>
        <TooltipPrimitive.Positioner side="top" sideOffset={8} collisionPadding={8} className="isolate z-50">
          <TooltipPrimitive.Popup data-slot="tooltip-content" className="z-50 inline-flex items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs font-semibold text-background duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            {label}
            {keys}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
