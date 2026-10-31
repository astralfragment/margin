import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type Anchor = { x: number; y: number; w?: number; h?: number };

type Props = {
  at: Anchor | null;
  onClose: () => void;
  /** Where focus goes when the menu closes, such as a label inside the preview. */
  returnFocus?: () => HTMLElement | null;
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * A menu that opens at a point or over a box, for places with no React trigger: the right-click menu of the
 * image editor and the severity and status labels inside the preview.
 */
export function PointMenu({ at, onClose, returnFocus, label, className, children }: Props) {
  return (
    <DropdownMenu open={Boolean(at)} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger
        nativeButton={false}
        aria-hidden
        tabIndex={-1}
        render={<span />}
        style={{ position: 'fixed', left: at?.x ?? 0, top: at?.y ?? 0, width: at?.w ?? 0, height: at?.h ?? 0, pointerEvents: 'none' }}
      />
      <DropdownMenuContent aria-label={label} className={className ?? 'w-auto min-w-48'} finalFocus={returnFocus ? () => returnFocus() ?? true : undefined}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
