import { useSyncExternalStore } from 'react';
import { CircleHelp, Keyboard, Plug, SlidersHorizontal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectionsTab } from './connections-tab';
import type { Provider } from './store';
import { ControlsTab } from './controls-tab';
import { HelpTab } from './help-tab';
import { SettingsTab } from './settings-tab';

const TABS = [
  { value: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { value: 'connections', label: 'Connections', icon: Plug },
  { value: 'controls', label: 'Controls', icon: Keyboard },
  { value: 'help', label: 'Help', icon: CircleHelp },
] as const;

type Tab = (typeof TABS)[number]['value'];
type Place = { tab: Tab; focus?: Provider };

/** Reads the tab, and the service to focus, from links such as options.html#connect-jira or #controls. */
function placeFromHash(value: string): Place {
  const hash = value.slice(1);
  if (hash === 'connect-jira' || hash === 'connect-figma') return { tab: 'connections', focus: hash.slice('connect-'.length) as Provider };
  const tab = TABS.find((t) => t.value === hash);
  return { tab: tab?.value ?? 'settings' };
}

/** The address hash is the tab, so a tab survives a reload and links can open any of them. */
function subscribeHash(onChange: () => void) {
  addEventListener('hashchange', onChange);
  return () => removeEventListener('hashchange', onChange);
}

/** Help and settings: one page with a tab per job, reachable by link. */
export function SettingsPage() {
  const place = placeFromHash(useSyncExternalStore(subscribeHash, () => location.hash));

  const choose = (tab: Tab) => {
    history.replaceState(null, '', `#${tab}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8 px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <header className="flex items-center gap-4">
        <img src="/icons/icon48.png" alt="" className="size-10 rounded-lg dark:ring-1 dark:ring-border" />
        <div className="grid gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight">Help and settings</h1>
          <p className="text-sm font-medium text-muted-foreground">Mark what looks wrong on any website, then share it as a Google Doc, a Word file, a web page or Jira issues.</p>
        </div>
      </header>

      <Tabs value={place.tab} onValueChange={(value) => choose(value as Tab)} className="gap-8">
        <TabsList className="h-10! w-full sm:w-fit">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="px-3">
              <Icon aria-hidden className="hidden sm:block" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="connections">
          <ConnectionsTab focus={place.focus} />
        </TabsContent>
        <TabsContent value="controls">
          <ControlsTab />
        </TabsContent>
        <TabsContent value="help">
          <HelpTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
