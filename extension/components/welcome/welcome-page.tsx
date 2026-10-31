import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Keys, useAnnotateShortcut } from '@/components/margin/shortcut';
import { useTheme } from '@/hooks/use-theme';
import { storageQuery } from '@/lib/query';
import { openReportTab } from '@/lib/report-tab.js';
import { readIssues } from '@/lib/store.js';
import { cn } from '@/lib/utils';
import { STEPS } from './steps';

const LAST = STEPS.length - 1;

/** Set once the tour is skipped or finished, so nothing opens it again by itself. */
const SEEN_KEY = 'onboardingSeen';

/** Marks the tour as seen and closes its tab. Resolves false when the tab cannot be closed, such as a page not opened as a tab. */
async function leave() {
  await chrome.storage.local.set({ [SEEN_KEY]: true });
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id == null) return false;
    await chrome.tabs.remove(tab.id);
    return true;
  } catch {
    return false;
  }
}

/** Shown when the tour ends but its tab could not be closed. */
function AllSet({ shortcut }: { shortcut: string }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center justify-items-center gap-4 px-4 py-16 text-center">
      <img src="/icons/icon48.png" alt="" className="size-10 rounded-lg dark:ring-1 dark:ring-border" />
      <h1 className="text-xl font-semibold tracking-tight">You're set</h1>
      <p className="text-sm leading-6 font-medium text-muted-foreground">Open any website and click Margin in the toolbar to start a review.</p>
      {shortcut && (
        <p className="text-sm leading-6 font-medium text-muted-foreground">
          Or press <Keys keys={shortcut} className="align-middle" /> on the page.
        </p>
      )}
    </main>
  );
}

/** True once there is at least one comment, so the tour can end in the report instead of closing. */
function useHasComments() {
  const { data = false } = useQuery(storageQuery(['has-comments'], ['issues'], async () => (await readIssues()).length > 0));
  return data;
}

/** The welcome tour: four short steps, each beside a screenshot of Margin in the current theme. */
export function WelcomePage() {
  const [step, setStep] = useState(0);
  const [allSet, setAllSet] = useState(false);
  const shortcut = useAnnotateShortcut();
  const hasComments = useHasComments();
  const theme = useTheme();
  const current = STEPS[step]!;

  const go = (next: number) => setStep(Math.min(Math.max(0, next), LAST));
  const skip = async () => {
    if (!(await leave())) setAllSet(true);
  };
  const finish = async () => {
    if (hasComments) await openReportTab();
    await skip();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, LAST));
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
      if (event.key === 'Escape') skip();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (allSet) return <AllSet shortcut={shortcut} />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-4 sm:px-8">
        <img src="/icons/icon48.png" alt="" className="size-7 rounded-md dark:ring-1 dark:ring-border" />
        <span className="mr-auto pl-1 text-sm font-semibold">Margin</span>
        <Button variant="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
          Help and settings
        </Button>
        <Button variant="outline" onClick={skip}>
          Skip tour
        </Button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-10 px-4 pt-4 pb-12 sm:px-8 lg:grid-cols-[24rem_minmax(0,1fr)] lg:gap-16">
        <section aria-labelledby="step-title" className="flex flex-col gap-8 lg:justify-between lg:self-stretch">
          <div className="grid gap-4">
            <p className="text-xs font-medium text-muted-foreground">Welcome to Margin</p>
            <h1 id="step-title" aria-live="polite" className="text-xl font-semibold tracking-tight text-balance">
              {current.title}
            </h1>
            <div key={step} className="grid gap-3 text-sm leading-6 font-medium text-muted-foreground duration-200 animate-in fade-in motion-reduce:animate-none">
              {current.body({ shortcut, skip })}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="flex items-center gap-3">
              <div className="-ml-2 flex gap-1">
                {STEPS.map((item, i) => (
                  <button
                    key={item.title}
                    type="button"
                    aria-label={`Step ${i + 1}, ${item.title}`}
                    aria-current={i === step ? 'step' : undefined}
                    onClick={() => go(i)}
                    className="grid size-6 place-items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className={cn('size-2 rounded-full transition-colors', i === step ? 'bg-foreground' : 'bg-border')} />
                  </button>
                ))}
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {step + 1} of {STEPS.length}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="lg" disabled={step === 0} onClick={() => go(step - 1)}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <Button size="lg" className="bg-action text-action-foreground hover:bg-action/80" onClick={() => (step === LAST ? finish() : go(step + 1))}>
                {step < LAST ? 'Next' : hasComments ? 'Open the report' : 'Done'}
                {step < LAST && <ArrowRight data-icon="inline-end" />}
              </Button>
            </div>
          </div>
        </section>

        <figure className="overflow-hidden rounded-xl border bg-background shadow-xl shadow-foreground/5">
          <img
            key={`${current.shot}-${theme}`}
            src={`/onboarding/${current.shot}-${theme}.webp`}
            alt={current.alt}
            width={1280}
            height={800}
            className="block aspect-[16/10] w-full duration-300 animate-in fade-in motion-reduce:animate-none"
          />
        </figure>
      </main>
    </div>
  );
}
