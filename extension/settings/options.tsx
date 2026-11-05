import { useQuery } from '@tanstack/react-query';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Connections } from './connections';
import { CaptureFields, ShortcutField, ThemeField } from './controls';
import { Help } from './help';
import { mountPage } from './mount';
import { usageQuery } from './queries';
import { Section } from './section';

const megabytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });
const kilobytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 });

/**
 * Formats a byte count for people.
 * @param bytes The size in bytes.
 */
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return kilobytes.format(Math.max(1, bytes / 1024));
  return megabytes.format(bytes / (1024 * 1024));
}

/** Opens the report with every review listed. */
const openReviews = () => chrome.tabs.create({ url: chrome.runtime.getURL('/report.html?group=all') });

/** How much Margin keeps on this computer, with a way to the reviews that take the space. */
function StorageUse() {
  const { data: usage } = useQuery(usageQuery);
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {usage
          ? `${usage.comments} ${usage.comments === 1 ? 'comment' : 'comments'} with their screenshots, ${formatSize(usage.bytes)}. Delete a review you no longer need to free space.`
          : 'Checking'}
      </p>
      <Button variant="outline" onClick={openReviews}>
        See reviews
      </Button>
    </div>
  );
}

/** Help and settings, opened from the popup, the report and Chrome's extension menu. */
function OptionsPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 text-base sm:py-14">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight">Help and settings</h1>
        <p className="text-sm text-muted-foreground">Margin {chrome.runtime.getManifest().version}</p>
      </header>

      <Section title="Annotating" description="These set how Margin starts. Both modes can be switched for the moment while you annotate.">
        <FieldGroup>
          <CaptureFields />
          <FieldSeparator />
          <ShortcutField />
        </FieldGroup>
      </Section>

      <Section title="Appearance">
        <FieldGroup>
          <ThemeField />
        </FieldGroup>
      </Section>

      <Section
        title="Connections"
        description="Connect once to send reviews to Jira or Figma. Margin asks for access to a service only when you connect it."
      >
        <Connections />
      </Section>

      <Section title="Stored on this computer">
        <StorageUse />
      </Section>

      <Section title="Help">
        <Help />
      </Section>
    </main>
  );
}

mountPage(<OptionsPage />);
