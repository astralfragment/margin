import { cn } from '@/lib/utils';

/**
 * A loading placeholder bar.
 * @param props Extra classes.
 */
const Bar = ({ className }: { className?: string }) => <span className={cn('block animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} />;

/** The report's shape while the review loads: a cover line, comment titles and screenshot frames. */
export function PreviewSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('overflow-hidden bg-background px-4 pt-14', className)}>
      <div className="mx-auto grid max-w-[1040px] gap-4">
        <Bar className="h-6 w-64" />
        <Bar className="h-4 w-48" />
        {[0, 1].map((i) => (
          <div key={i} className="mt-6 grid gap-3 pl-9">
            <Bar className="h-5 w-80 max-w-full" />
            <Bar className="h-4 w-96 max-w-full" />
            <Bar className="aspect-[16/7] w-full max-w-2xl rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The whole screen while the review loads. */
export function ReportSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy aria-label="Loading the review">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Bar className="h-5 w-20 max-lg:hidden" />
        <Bar className="h-5 w-40" />
        <span className="flex-1" />
        <Bar className="h-8 w-24 rounded-lg" />
        <Bar className="h-8 w-32 rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="grid w-72 shrink-0 content-start gap-3 border-r border-sidebar-border bg-sidebar p-3 max-md:hidden">
          <Bar className="h-8 rounded-lg" />
          <Bar className="h-8 rounded-lg" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Bar key={i} className="h-9" />
          ))}
        </div>
        <PreviewSkeleton className="flex-1" />
      </div>
    </div>
  );
}
