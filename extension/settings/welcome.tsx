import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Globe, MousePointerClick, SquareDashedMousePointer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Connections } from './connections';
import { CaptureFields, Shortcut, ShortcutField, ThemeField } from './controls';
import { mountPage } from './mount';
import { shortcutQuery } from './queries';
import { Section } from './section';

const SAMPLE_PAGE = 'https://lilacfragment.co.za/margin/';

/** Opens a real page to try the first comment on, since annotation cannot run on Margin's own pages. */
const openSamplePage = () => chrome.tabs.create({ url: SAMPLE_PAGE });

/**
 * One numbered step towards the first comment.
 * @param props.number The step number.
 * @param props.icon The step's icon.
 * @param props.title What to do.
 * @param props.children How to do it.
 */
function Step({ number, icon: Icon, title, children }: { number: number; icon: typeof Globe; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-muted p-4">
      <div className="flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {number}
        </span>
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </li>
  );
}

/** The three steps from install to the first comment, with a page to try them on. */
function FirstComment() {
  const { data: shortcut } = useQuery(shortcutQuery);
  return (
    <section aria-labelledby="first-comment" className="flex flex-col gap-4">
      <h2 id="first-comment" className="sr-only">
        Make your first comment
      </h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        <Step number={1} icon={Globe} title="Open a page">
          Go to any website you want to review.
        </Step>
        <Step number={2} icon={MousePointerClick} title="Start Margin">
          {shortcut ? (
            <>
              Press <Shortcut shortcut={shortcut} /> or click the Margin icon in the toolbar.
            </>
          ) : (
            'Click the Margin icon in the toolbar.'
          )}{' '}
          Pin it from the puzzle piece menu to keep it in reach.
        </Step>
        <Step number={3} icon={SquareDashedMousePointer} title="Drag over the problem">
          Draw a box around what looks wrong, write a note and save. That is your first comment.
        </Step>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant="action" onClick={openSamplePage}>
          Try it on a sample page
          <ArrowRight data-icon="inline-end" />
        </Button>
        <p className="text-sm text-muted-foreground">Or open any site of your own.</p>
      </div>
    </section>
  );
}

/** Opens help and settings. */
const openSettings = () => chrome.runtime.openOptionsPage();

/** The page that opens on install. It gets someone to a first comment, then offers a few choices with good defaults. */
function WelcomePage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-8 text-base sm:py-12">
      <header className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-lg font-extrabold">
          <img src="/icons/icon48.png" alt="" className="size-7" />
          Margin
        </span>
        <Button variant="ghost" onClick={openSettings}>
          Help and settings
        </Button>
      </header>

      <main className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">Margin is ready</h1>
          <p className="max-w-xl text-muted-foreground">
            Mark up any website, say what is wrong, and hand over a clean review as a Doc, a Word file or a Jira issue. Your
            first comment takes three steps.
          </p>
        </div>

        <FirstComment />

        <Section title="Set it up your way" description="Each choice is saved as you make it. The defaults work well, so skip any you are unsure of.">
          <FieldGroup>
            <ThemeField />
            <FieldSeparator />
            <CaptureFields />
            <FieldSeparator />
            <ShortcutField />
          </FieldGroup>
        </Section>

        <Section
          title="Send reviews to Jira and Figma"
          action={<Badge variant="secondary">Optional</Badge>}
          description="Connect with one sign-in each. Margin asks for access to a service only when you connect it."
        >
          <Connections />
        </Section>
      </main>
    </div>
  );
}

mountPage(<WelcomePage />);
