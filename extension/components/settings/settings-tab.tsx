import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Keys, useAnnotateShortcut } from '@/components/margin/shortcut';
import { useSetStorageValue, useStorageValue } from '@/hooks/use-storage';
import { openShortcutSettings } from '@/lib/controls.js';
import { storageQuery } from '@/lib/query';
import { openReportTab } from '@/lib/report-tab.js';
import { readIssues } from '@/lib/store.js';
import { ACCENT_KEY, THEME_KEY, THEMES, resolveAccent } from '@/lib/theme.js';
import { AccentPicker } from './accent-picker';
import { SettingGroup, SettingRow } from './setting-row';
import { Switch } from './switch';

const THEME_ITEMS = THEMES.map((theme) => ({ value: theme.key, label: theme.label }));

/**
 * Formats a byte count for people.
 * @param bytes The size in bytes.
 */
function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SwitchRowProps = { storageKey: string; on: (stored?: boolean) => boolean; title: string; description: ReactNode };

/** A setting stored as a boolean. `on` reads the stored value, since each key has its own default. */
function SwitchRow({ storageKey, on, title, description }: SwitchRowProps) {
  const id = useId();
  const { data } = useStorageValue<boolean | undefined>(storageKey, undefined);
  const save = useSetStorageValue<boolean>(storageKey);
  return (
    <SettingRow title={title} description={description} titleId={`${id}-t`} descriptionId={`${id}-d`}>
      <Switch checked={on(data)} onCheckedChange={(checked) => save.mutate(checked)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} />
    </SettingRow>
  );
}

/** How much storage the reviews use. */
function StorageSummary() {
  const { data: summary } = useQuery(
    storageQuery(['storage-summary'], ['*'], async () => {
      const [issues, bytes] = await Promise.all([readIssues(), chrome.storage.local.getBytesInUse(null)]);
      const count = issues.length;
      return count ? `${count} ${count === 1 ? 'comment' : 'comments'} with their screenshots, ${size(bytes)} in all.` : 'No reviews yet.';
    }),
  );
  return (
    <SettingRow
      title="Stored on this computer"
      description={
        <>
          <span className="block">{summary ?? <span className="inline-block h-4 w-48 animate-pulse rounded-sm bg-muted align-middle" />}</span>
          <span className="block">Nothing leaves this computer until you share it. Delete a review you no longer need to free space.</span>
        </>
      }
    >
      <Button variant="outline" onClick={() => openReportTab('group=all')}>
        <FolderOpen data-icon="inline-start" />
        See reviews
      </Button>
    </SettingRow>
  );
}

/** The keyboard shortcut and where to change it. */
function ShortcutRow() {
  const shortcut = useAnnotateShortcut();
  return (
    <SettingRow
      title="Start and stop shortcut"
      description={
        shortcut ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Keys keys={shortcut} /> starts and stops Margin on any page.
          </span>
        ) : (
          'Not set yet. Chrome may have skipped it because another extension already uses the same keys. Pick your own keys in Chrome.'
        )
      }
    >
      <Button variant="outline" onClick={openShortcutSettings}>
        {shortcut ? 'Change in Chrome' : 'Set in Chrome'}
        <ArrowUpRight data-icon="inline-end" />
      </Button>
    </SettingRow>
  );
}

/** Theme, capture defaults, the shortcut and storage. */
export function SettingsTab() {
  const themeId = useId();
  const { data: theme } = useStorageValue(THEME_KEY, 'system');
  const setTheme = useSetStorageValue<string>(THEME_KEY);
  const { data: accent } = useStorageValue(ACCENT_KEY, 'lime');
  const setAccent = useSetStorageValue<string>(ACCENT_KEY);
  return (
    <div className="grid gap-8">
      <section aria-labelledby={`${themeId}-h`} className="grid gap-3">
        <h2 id={`${themeId}-h`} className="text-base font-semibold">
          Look
        </h2>
        <SettingGroup>
          <SettingRow title="Theme" description="For the popup, the report and these pages." titleId={`${themeId}-t`}>
            <Select items={THEME_ITEMS} value={theme} onValueChange={(value) => value && setTheme.mutate(value)}>
              <SelectTrigger className="min-w-48" aria-labelledby={`${themeId}-t`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="Accent colour" description="For the main button on each screen and the focus ring." titleId={`${themeId}-a`}>
            <AccentPicker value={resolveAccent(accent)} onChange={(key) => setAccent.mutate(key)} labelledBy={`${themeId}-a`} />
          </SettingRow>
        </SettingGroup>
      </section>

      <section aria-labelledby={`${themeId}-c`} className="grid gap-3">
        <h2 id={`${themeId}-c`} className="text-base font-semibold">
          While you review
        </h2>
        <SettingGroup>
          <SwitchRow
            storageKey="selectorMode"
            on={(stored) => stored === true}
            title="Pick element by default"
            description={
              <>
                Click a part of the page to comment on it, instead of drawing a box. Press <Keys keys={['S']} className="align-middle" /> while reviewing to switch.
              </>
            }
          />
          <SwitchRow
            storageKey="markerMode"
            on={(stored) => stored !== false}
            title="Numbered markers while capturing"
            description={
              <>
                After you draw a box, click inside it to add numbered points, each with its own note. Press <Keys keys={['M']} className="align-middle" /> to switch.
              </>
            }
          />
          <ShortcutRow />
        </SettingGroup>
      </section>

      <section aria-labelledby={`${themeId}-s`} className="grid gap-3">
        <h2 id={`${themeId}-s`} className="text-base font-semibold">
          Your reviews
        </h2>
        <SettingGroup>
          <StorageSummary />
        </SettingGroup>
      </section>
    </div>
  );
}
