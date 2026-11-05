import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FrameIcon, LinkIcon, MapPinIcon, TextIcon, XIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { FigmaFileFrame, Severity } from '@/lib/model';
import { SEVERITIES } from '@/lib/severity.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { reviewQuery } from '../../query';
import { useOverlay, overlayStore } from '../../store';
import { MARKER_PIN } from '../NumberFlag';

/** Each severity button's tinted hover and selected look, and its dot, written out so Tailwind finds the classes. */
const SEVERITY_LOOK: Record<Severity, { button: string; dot: string }> = {
  blocker: { button: 'hover:bg-blocker-tint aria-pressed:border-blocker aria-pressed:bg-blocker-tint aria-pressed:text-blocker', dot: 'bg-blocker-solid' },
  major: { button: 'hover:bg-major-tint aria-pressed:border-major aria-pressed:bg-major-tint aria-pressed:text-major', dot: 'bg-major-solid' },
  minor: { button: 'hover:bg-minor-tint aria-pressed:border-minor aria-pressed:bg-minor-tint aria-pressed:text-minor', dot: 'bg-minor-solid' },
  nit: { button: 'hover:bg-nit-tint aria-pressed:border-nit aria-pressed:bg-nit-tint aria-pressed:text-nit', dot: 'bg-nit-solid' },
};

/**
 * Keeps a one-line field to one paragraph.
 * @param value What was typed or pasted.
 */
const oneLine = (value: string) => value.replace(/\s*\n\s*/g, ' ');

/** The comment itself, a labelled box several lines tall. Enter saves. */
export function TitleField() {
  const title = useOverlay((state) => state.card?.title ?? '');
  const { editCard } = overlayStore.getState();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Comment</FieldLabel>
      <Textarea
        id={id}
        data-card-title
        data-line
        rows={3}
        value={title}
        placeholder="What is wrong?"
        className="max-h-40 min-h-20 resize-none"
        onChange={(event) => editCard({ title: oneLine(event.target.value), asking: null })}
      />
    </Field>
  );
}

/** Blocker, Major, Minor and Nit as four coloured buttons, picked with a click, the arrow keys, or 1 to 4. */
export function SeverityPicker() {
  const severity = useOverlay((state) => state.card?.severity ?? 'major');
  const { editCard } = overlayStore.getState();
  return (
    <ToggleGroup
      aria-label="Severity"
      variant="outline"
      size="sm"
      spacing={1}
      value={[severity]}
      onValueChange={(values: string[]) => values[0] && editCard({ severity: values[0] as Severity })}
      className="w-full"
    >
      {SEVERITIES.map((entry, index) => {
        const look = SEVERITY_LOOK[entry.key as Severity];
        return (
          <ToggleGroupItem
            key={entry.key}
            data-severity={entry.key}
            value={entry.key}
            title={`${entry.label}, key ${index + 1}`}
            className={cn('flex-1 gap-2 border-border text-foreground', look.button)}
          >
            <i className={cn('size-2 rounded-full', look.dot)} />
            {entry.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/** The labelled note, once Add note opens it. Enter adds a line and Ctrl+Enter saves. */
export function NoteField() {
  const { note, noteOpen } = useOverlay(useShallow((state) => ({ note: state.card?.note ?? '', noteOpen: state.card?.noteOpen ?? false })));
  const { editCard } = overlayStore.getState();
  const id = useId();
  if (!noteOpen) return null;
  return (
    <Field>
      <FieldLabel htmlFor={id}>Note</FieldLabel>
      <Textarea
        id={id}
        data-card-note
        autoFocus
        value={note}
        placeholder="What you expected, what happened"
        className="max-h-48 min-h-16 resize-none"
        onChange={(event) => editCard({ note: event.target.value, asking: null })}
      />
    </Field>
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
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
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
    <b className={cn(MARKER_PIN, className)}>
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
            <span className="text-xs font-semibold text-muted-foreground">Figma frame</span>
            <b className="truncate font-semibold">{frame.name}</b>
            <span className="truncate text-xs text-muted-foreground">{[frame.page, file?.name].filter(Boolean).join(' in ')}</span>
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
    <div className="-ml-2 flex flex-wrap items-center gap-1">
      {!noteOpen && (
        <Button data-add-note variant="ghost" size="sm" onClick={() => editCard({ noteOpen: true })}>
          <TextIcon />
          Add note
        </Button>
      )}
      {!placing && (
        <Button data-add-marker variant="ghost" size="sm" onClick={() => setPlacing(true)}>
          <MapPinIcon />
          Add marker
        </Button>
      )}
      {!frame && !linkOpen && (
        <Button
          data-margin-popup
          variant="ghost"
          size="sm"
          aria-expanded={framePickerOpen}
          className="aria-expanded:text-ink"
          onClick={() => (hasFrames ? editCard({ framePickerOpen: !framePickerOpen }) : editCard({ linkOpen: true }))}
        >
          {hasFrames ? <FrameIcon /> : <LinkIcon />}
          {hasFrames ? 'Figma frame' : 'Figma link'}
        </Button>
      )}
    </div>
  );
}
