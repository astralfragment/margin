import type { ReactNode } from 'react';
import { Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Keys } from '@/components/margin/shortcut';
import { openShortcutSettings } from '@/lib/controls.js';

export type Step = {
  title: string;
  /** The screenshot in public/onboarding, without the theme and extension. */
  shot: string;
  alt: string;
  body: (context: { shortcut: string; skip: () => void }) => ReactNode;
};

export const STEPS: Step[] = [
  {
    title: 'Start on any website',
    shot: 'start',
    alt: 'A website with the Margin bar along the bottom, ready for a review.',
    body: ({ shortcut }) => (
      <>
        <p>Open the website you want to review. Click Margin in your browser toolbar, then choose Start review.</p>
        <p>Can't see Margin? Click the puzzle piece icon and pin it.</p>
        {shortcut ? (
          <p>
            Or press <Keys keys={shortcut} className="align-middle" /> on any page. Press it again to stop.
          </p>
        ) : (
          <div className="grid justify-items-start gap-3">
            <p>You can also start with a shortcut. Chrome has not set one yet.</p>
            <Button variant="outline" onClick={openShortcutSettings}>
              Set shortcut
            </Button>
          </div>
        )}
      </>
    ),
  },
  {
    title: 'Mark what is wrong',
    shot: 'mark',
    alt: 'A box drawn around a button on the page, with the note open beside it.',
    body: () => (
      <>
        <p>Drag a box around the problem. Margin keeps a picture of it.</p>
        <p>
          Write a short title, choose how serious it is, then press <Keys keys={['Enter']} className="align-middle" /> to save.
        </p>
      </>
    ),
  },
  {
    title: 'Share the review',
    shot: 'share',
    alt: 'The Margin report listing the comments of a review.',
    body: () => (
      <>
        <p>Open the report and copy the review into Google Docs, or save it as a Word or HTML file.</p>
        <p>After the fixes, choose Recheck to show each problem before and after.</p>
      </>
    ),
  },
  {
    title: 'Connect Jira or Figma',
    shot: 'connect',
    alt: 'The Connections tab in Help and settings, with Jira connected.',
    body: ({ skip }) => (
      <>
        <p>Optional. If your team uses Jira or Figma, send comments straight there. Sharing works fine without it.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#connections') })}>
            <Plug data-icon="inline-start" />
            Open connections
          </Button>
          <Button variant="ghost" onClick={skip}>
            Skip, you can do this later
          </Button>
        </div>
      </>
    ),
  },
];
