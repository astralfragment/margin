import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Props = ComponentProps<typeof Button> & { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' };

/** A ghost icon button named by its tooltip and aria-label. Other props pass through, so it can be a menu trigger. */
export function IconButton({ label, children, side = 'bottom', size = 'icon-sm', variant = 'ghost', ...props }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} size={size} variant={variant} {...props}>
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
