import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ThemeChoice } from '@/lib/model';
import { markerModeItem, selectorModeItem, themeItem } from '@/lib/storage';
import { shortcutQuery, useSaveStored, useStored } from './queries';

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * Shows a Chrome shortcut such as Alt+Shift+M as one key cap per key.
 * @param props.shortcut The shortcut as Chrome reports it.
 */
export function Shortcut({ shortcut }: { shortcut: string }) {
  return (
    <KbdGroup>
      {shortcut.split('+').map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** The theme choice, which applies to every Margin page. */
export function ThemeField() {
  const theme = useStored(themeItem);
  const save = useSaveStored(themeItem);
  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldTitle id="theme-title">Theme</FieldTitle>
        <FieldDescription>System follows your computer's light or dark setting.</FieldDescription>
        <FieldError>{save.error?.message}</FieldError>
      </FieldContent>
      <ToggleGroup
        aria-labelledby="theme-title"
        variant="outline"
        spacing={0}
        value={[theme]}
        onValueChange={([picked]) => {
          const next = THEMES.find(({ value }) => value === picked);
          if (next) save.mutate(next.value);
        }}
      >
        {THEMES.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem key={value} value={value}>
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}

/**
 * One on or off setting with a title and a sentence on what it does.
 * @param props.id The id the label points at.
 * @param props.title The setting's name.
 * @param props.description What turning it on does.
 * @param props.checked Whether it is on.
 * @param props.onCheckedChange Called with the new state.
 * @param props.error A failed save to show.
 */
function SwitchField({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  error,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{title}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
        <FieldError>{error}</FieldError>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="data-unchecked:bg-muted-foreground/30" />
    </Field>
  );
}

/** Whether markers and selector capture start on. Both can be switched for the moment while annotating. */
export function CaptureFields() {
  const markers = useStored(markerModeItem);
  const selectors = useStored(selectorModeItem);
  const saveMarkers = useSaveStored(markerModeItem);
  const saveSelectors = useSaveStored(selectorModeItem);
  return (
    <>
      <SwitchField
        id="markers"
        title="Numbered markers"
        description={
          <>
            After you drag a region, each click inside it drops a numbered marker with its own note. Press <Kbd>M</Kbd> while
            annotating to switch it for the moment.
          </>
        }
        checked={markers}
        onCheckedChange={(checked) => saveMarkers.mutate(checked)}
        error={saveMarkers.error?.message}
      />
      <SwitchField
        id="selectors"
        title="Element selectors"
        description={
          <>
            Hovering outlines elements and a click picks one, so each comment keeps the element's CSS selector for whoever
            fixes it. Press <Kbd>S</Kbd> while annotating to switch it for the moment.
          </>
        }
        checked={selectors}
        onCheckedChange={(checked) => saveSelectors.mutate(checked)}
        error={saveSelectors.error?.message}
      />
    </>
  );
}

/** Opens Chrome's shortcut page, which an extension page can only reach through the tabs API. */
const openShortcutSettings = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

/** The shortcut that starts and stops annotating, with a way to change it in Chrome. */
export function ShortcutField() {
  const { data: shortcut } = useQuery(shortcutQuery);
  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldTitle>Keyboard shortcut</FieldTitle>
        <FieldDescription>
          {shortcut ? (
            <>
              <Shortcut shortcut={shortcut} /> starts and stops annotating on the page you are on.
            </>
          ) : (
            'No shortcut is set. Pick one in Chrome to start and stop annotating from the keyboard.'
          )}
        </FieldDescription>
      </FieldContent>
      <Button variant="outline" onClick={openShortcutSettings}>
        Change in Chrome
        <ExternalLink data-icon="inline-end" />
      </Button>
    </Field>
  );
}
