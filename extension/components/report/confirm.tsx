import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type ConfirmChoice = { label: string; value: string | null; kind?: 'primary' | 'destructive' };
export type ConfirmAsk = { title: string; body: string; buttons: ConfirmChoice[] };
type Confirm = (ask: ConfirmAsk) => Promise<string | null>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(null));

/** Asks a question in a small dialog. Resolves with the value of the button pressed, or null on Escape. */
export const useConfirm = () => useContext(ConfirmContext);

/**
 * Provides the confirm dialog to the report.
 * @param props The report content.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<ConfirmAsk | null>(null);
  const resolver = useRef<(value: string | null) => void>(null);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setAsk(next);
      }),
    [],
  );

  const done = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsk(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(ask)} onOpenChange={(open) => !open && done(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ask?.title}</DialogTitle>
            <DialogDescription>{ask?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {ask?.buttons.map((button, i) => (
              <Button
                key={button.label}
                autoFocus={i === 0}
                variant={button.kind === 'destructive' ? 'destructive' : button.kind === 'primary' ? 'default' : 'outline'}
                onClick={() => done(button.value)}
              >
                {button.label}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
