import { useState } from 'react';
import { ArrowUpRight, Bug, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportProblem } from '@/lib/feedback.js';
import { resetTours } from '@/lib/tour.js';
import { SettingGroup, SettingRow } from './setting-row';

const SUPPORT_URL = 'https://lilacfragment.co.za/margin/support/';

/** The tour, the tips, and where to go when something breaks. */
export function HelpTab() {
  const [tipsReset, setTipsReset] = useState(false);
  const version = chrome.runtime.getManifest().version;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="help-start" className="grid gap-3">
        <h2 id="help-start" className="text-base font-semibold">
          Getting started
        </h2>
        <SettingGroup>
          <SettingRow title="Take the tour" description="A whole review in seven short steps.">
            <Button className="bg-action text-action-foreground hover:bg-action/80" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') })}>
              <Play data-icon="inline-start" />
              Take the tour
            </Button>
          </SettingRow>
          <SettingRow
            title="Show the tips again"
            description={
              <span role="status">{tipsReset ? 'Done. The tips show next time you open the popup or the report.' : 'Tips point at the real buttons the first time you open the popup and the report.'}</span>
            }
          >
            <Button
              variant="outline"
              disabled={tipsReset}
              onClick={async () => {
                await resetTours();
                setTipsReset(true);
              }}
            >
              <RotateCcw data-icon="inline-start" />
              Show the tips again
            </Button>
          </SettingRow>
        </SettingGroup>
      </section>

      <section aria-labelledby="help-problem" className="grid gap-3">
        <h2 id="help-problem" className="text-base font-semibold">
          Something not working?
        </h2>
        <SettingGroup>
          <SettingRow title="Report a problem" description="Tell us in a sentence. It opens on GitHub with your Margin version and browser filled in.">
            <Button variant="outline" onClick={() => reportProblem('settings')}>
              <Bug data-icon="inline-start" />
              Report a problem
            </Button>
          </SettingRow>
          <SettingRow title="Support page" description="Answers to common questions.">
            <Button variant="outline" nativeButton={false} render={<a href={SUPPORT_URL} target="_blank" rel="noopener" />}>
              Open support page
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </SettingRow>
        </SettingGroup>
      </section>

      <p className="text-xs font-medium text-muted-foreground">Margin version {version}</p>
    </div>
  );
}
