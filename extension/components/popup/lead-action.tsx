import type { ReactNode } from 'react';
import { CircleStop, SquareDashedMousePointer, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Keys } from '@/components/margin/shortcut';

type Props = { annotating: boolean; shortcut: string; busy?: boolean; label?: string; onClick: () => void };

/** The one lead button: start or stop annotating, with the shortcut that does the same. */
export function LeadAction({ annotating, shortcut, busy, label, onClick }: Props) {
  const Icon = annotating ? CircleStop : SquareDashedMousePointer;
  return (
    <Button
      data-tour="lead"
      size="lg"
      disabled={busy}
      onClick={onClick}
      className="h-10 w-full justify-start gap-2 bg-action px-3 text-sm font-semibold text-action-foreground hover:bg-action/85"
    >
      <Icon className="size-4" />
      <span className="flex-1 text-left">{label ?? (annotating ? 'Stop annotating' : 'Start annotating')}</span>
      {shortcut && <Keys keys={shortcut} className="gap-1 [&_kbd]:h-5 [&_kbd]:bg-transparent [&_kbd]:px-1 [&_kbd]:font-medium [&_kbd]:text-action-foreground [&_kbd]:ring-1 [&_kbd]:ring-action-foreground/20" />}
    </Button>
  );
}

/** A problem starting Margin on this page, in plain words. */
export function StartAlert({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl bg-destructive/10 p-3 text-sm animate-in fade-in-0 motion-reduce:animate-none">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="grid gap-1">
        <b className="font-semibold">{title}</b>
        <span className="font-medium text-muted-foreground">{text}</span>
      </p>
    </div>
  );
}

/** A calm notice with an icon, a title and a line or two. */
export function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div role="status" className="grid justify-items-center gap-2 rounded-xl bg-muted p-4 text-center">
      <span className="text-muted-foreground [&_svg]:size-5">{icon}</span>
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid gap-1 text-sm font-medium text-muted-foreground">{children}</div>
    </div>
  );
}
