import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { cn } from '@/lib/utils';

/** The shadcn radio group in the base-nova style. */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props<string>) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn('grid gap-2', className)} {...props} />;
}

/**
 * One choice in a radio group.
 * @param props Radio props and extra classes.
 */
function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props<string>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-primary" />
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
