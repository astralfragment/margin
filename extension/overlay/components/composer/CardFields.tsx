import { useQuery } from '@tanstack/react-query';
import { CheckIcon, LinkIcon, PlusIcon, XIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { FigmaFileFrame, Severity } from '@/lib/model';
import { SEVERITIES } from '@/lib/severity.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { reviewQuery } from '../../query';
import { useOverlay, overlayStore } from '../../store';
import { isFilled } from '../../store/composer';

/** The pressed look of each severity, written out so Tailwind finds the classes. */
const SEVERITY_PRESSED: Record<Severity, string> = {
  blocker: 'data-[pressed]:bg-blocker-tint data-[pressed]:text-blocker',
  major: 'data-[pressed]:bg-major-tint data-[pressed]:text-major',
  minor: 'data-[pressed]:bg-minor-tint data-[pressed]:text-minor',
  nit: 'data-[pressed]:bg-nit-tint data-[pressed]:text-nit',
};

/**
 * Keeps a one-line field to one paragraph.
 * @param value What was typed or pasted.
 */
const oneLine = (value: string) => value.replace(/\s*\n\s*/g, ' ');

/** The card's title, with the hint that says what saving needs. */
export function TitleField() {
  const { title, note } = useOverlay(useShallow((state) => ({ title: state.card?.title ?? '', note: state.card?.note ?? '' })));
  const { editCard } = overlayStore.getState();
  return (
    <div className="grid gap-1.5">
      <Textarea
        data-card-title
        data-line
        rows={1}
        value={title}
        placeholder="What is wrong"
        aria-label="What is wrong"
        className="max-h-32 min-h-8 resize-none py-1.5 text-[15px] leading-5"
        onChange={(event) => editCard({ title: oneLine(event.target.value), asking: null })}
      />
      {!isFilled({ title, note }) && <span className="text-[13px] leading-[18px] text-muted-foreground">Add a title or a note to save</span>}
    </div>
  );
}

/** Blocker, Major, Minor and Nit, picked with a click, the arrow keys, or 1 to 4. */
export function SeverityPicker() {
  const severity = useOverlay((state) => state.card?.severity ?? 'major');
  const { editCard } = overlayStore.getState();
  return (
    <ToggleGroup
      aria-label="Severity"
      spacing={1}
      value={[severity]}
      onValueChange={(values: string[]) => values[0] && editCard({ severity: values[0] as Severity })}
      className="w-full rounded-md bg-muted p-0.5 dark:bg-background dark:ring-1 dark:ring-border"
    >
      {SEVERITIES.map((entry, index) => (
        <ToggleGroupItem
          key={entry.key}
          value={entry.key}
          size="sm"
          title={`${entry.label}, key ${index + 1}`}
          className={cn('h-7 flex-1 gap-1 rounded-sm text-[13px] font-semibold hover:bg-popover', SEVERITY_PRESSED[entry.key as Severity])}
        >
          <CheckIcon className="hidden size-3 group-data-[pressed]/toggle:block" />
          {entry.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The note, once Add note opens it. Enter adds a line and Ctrl+Enter saves. */
export function NoteField() {
  const { note, noteOpen } = useOverlay(useShallow((state) => ({ note: state.card?.note ?? '', noteOpen: state.card?.noteOpen ?? false })));
  const { editCard } = overlayStore.getState();
  if (!noteOpen) return null;
  return (
    <Textarea
      data-card-note
      autoFocus
      value={note}
      placeholder="What you expected, what happened"
      aria-label="Note"
      className="max-h-[200px] min-h-[76px] resize-none"
      onChange={(event) => editCard({ note: event.target.value, asking: null })}
    />
  );
}

/** A note row for each numbered marker, and the hint while the next one is being placed. */
export function MarkerNotes() {
  const { markers, placing } = useOverlay(useShallow((state) => ({ markers: state.markers, placing: state.placing })));
  const { setMarkerNote, removeMarker } = overlayStore.getState();
  return (
    <>
      {markers.length > 0 && (
        <div className="grid gap-2">
          {markers.map((marker, index) => (
            <div key={index} className="flex min-w-0 items-center gap-2">
              <MarkerPin number={index + 1} />
              <Textarea
                data-line
                data-marker-note={index}
                rows={1}
                value={marker.note}
                placeholder={`What marker ${index + 1} points out`}
                aria-label={`Note for marker ${index + 1}`}
                className="max-h-32 min-h-8 resize-none py-1.5"
                onChange={(event) => setMarkerNote(index, oneLine(event.target.value))}
              />
              <Button variant="ghost" size="icon-sm" aria-label={`Remove marker ${index + 1}`} onClick={() => removeMarker(index, true)}>
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      {placing && (
        <p className="flex items-center gap-2 text-[13px] leading-[18px] text-muted-foreground">
          <MarkerPin number={markers.length + 1} className="opacity-45" />
          Click inside the area to place marker {markers.length + 1}
        </p>
      )}
    </>
  );
}

/**
 * A marker's number in the pin shape the page shows.
 * @param props The number and any extra classes.
 */
function MarkerPin({ number, className }: { number: number; className?: string }) {
  return (
    <b
      className={cn(
        'grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-[11px_11px_11px_3px] border-2 border-ink-foreground bg-ink px-1 text-[13px] leading-4 font-extrabold text-ink-foreground',
        className,
      )}
    >
      {number}
    </b>
  );
}

/**
 * Scores how well a Figma page name matches this page's address and title, so the likeliest page lists first.
 * @param page The Figma page name.
 */
function pageScore(page: string) {
  const words = `${location.pathname} ${document.title}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  const name = page.toLowerCase();
  const home = location.pathname.replace(/\/+$/, '') === '' && /home|landing|index/.test(name) ? 2 : 0;
  return home + words.filter((word) => name.includes(word)).length;
}

/** The comment's Figma frame or link: the frame picked, the link field, or the searchable list of the file's frames. */
export function FigmaField() {
  const { frame, link, linkOpen, framePickerOpen } = useOverlay(
    useShallow((state) => ({ frame: state.card?.frame ?? null, link: state.card?.link ?? '', linkOpen: state.card?.linkOpen ?? false, framePickerOpen: state.card?.framePickerOpen ?? false })),
  );
  const file = useQuery(reviewQuery).data?.figma;
  const { editCard } = overlayStore.getState();
  const frames = file?.frames ?? [];
  const groups = [...new Set(frames.map((entry) => entry.page ?? ''))]
    .toSorted((first, second) => pageScore(second) - pageScore(first))
    .map((page) => ({ value: page || 'Frames', items: frames.filter((entry) => (entry.page ?? '') === page) }));
  /**
   * Links a frame from the review's Figma file and closes the list.
   * @param picked The frame.
   */
  const pick = (picked: FigmaFileFrame | null) => {
    if (!picked || !file) return;
    editCard({ frame: { fileKey: file.fileKey, nodeId: picked.id, name: picked.name, page: picked.page ?? '' }, framePickerOpen: false, asking: null });
  };
  return (
    <>
      {frame && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid min-w-0 flex-1">
            <span className="text-[13px] leading-[18px] font-semibold text-muted-foreground">Frame</span>
            <b className="truncate font-semibold">{frame.name}</b>
            <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{[frame.page, file?.name].filter(Boolean).join(' in ')}</span>
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Remove the frame" onClick={() => editCard({ frame: null })}>
            <XIcon />
          </Button>
        </div>
      )}
      {linkOpen && (
        <div className="flex min-w-0 items-center gap-2">
          <Input
            data-card-link
            value={link}
            autoFocus
            placeholder="Paste a Figma link"
            aria-label="Figma link"
            onChange={(event) => editCard({ link: event.target.value, asking: null })}
          />
          <Button variant="ghost" size="icon-sm" aria-label="Remove the Figma link" onClick={() => editCard({ link: '', linkOpen: false })}>
            <XIcon />
          </Button>
        </div>
      )}
      {framePickerOpen && file && (
        <Combobox<FigmaFileFrame>
          items={groups}
          open
          autoHighlight
          onOpenChange={(open) => !open && editCard({ framePickerOpen: false })}
          onValueChange={pick}
          itemToStringLabel={(entry) => entry.name}
          isItemEqualToValue={(entry, value) => entry.id === value.id}
        >
          <ComboboxInput data-margin-popup autoFocus showTrigger={false} placeholder={`Search frames in ${file.name}`} aria-label="Search frames" className="w-full" />
          <ComboboxContent data-margin-popup data-margin-float>
            <ComboboxEmpty>No frames match</ComboboxEmpty>
            <ComboboxList>
              {(group: { value: string; items: FigmaFileFrame[] }) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(entry: FigmaFileFrame) => (
                      <ComboboxItem key={entry.id} value={entry}>
                        {entry.name}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </>
  );
}

/** The quiet actions that add to the card, each shown only while it still has something to add. */
export function AddActions() {
  const { noteOpen, placing, frame, linkOpen, framePickerOpen } = useOverlay(
    useShallow((state) => ({
      noteOpen: state.card?.noteOpen ?? false,
      placing: state.placing,
      frame: state.card?.frame ?? null,
      linkOpen: state.card?.linkOpen ?? false,
      framePickerOpen: state.card?.framePickerOpen ?? false,
    })),
  );
  const hasFrames = Boolean(useQuery(reviewQuery).data?.figma?.frames?.length);
  const { editCard, setPlacing } = overlayStore.getState();
  return (
    <div className="-ml-1 flex items-center gap-0.5">
      {!noteOpen && (
        <Button variant="ghost" size="sm" onClick={() => editCard({ noteOpen: true })}>
          <PlusIcon />
          Add note
        </Button>
      )}
      {!placing && (
        <Button data-add-marker variant="ghost" size="sm" onClick={() => setPlacing(true)}>
          <PlusIcon />
          Add marker
        </Button>
      )}
      {!frame && !linkOpen && (
        <Button
          data-margin-popup
          variant="ghost"
          size="sm"
          aria-expanded={framePickerOpen}
          className="aria-expanded:bg-accent aria-expanded:text-ink"
          onClick={() => (hasFrames ? editCard({ framePickerOpen: !framePickerOpen }) : editCard({ linkOpen: true }))}
        >
          <LinkIcon />
          {hasFrames ? 'Frame' : 'Figma link'}
        </Button>
      )}
    </div>
  );
}
