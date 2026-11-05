import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { closeNote, removeNoted, saveNote } from './quick-marks';
import { useReportUi, type NoteTarget } from './ui-store';
import { useReportComments } from './use-report';

/**
 * The note box of one marker. Keyed by marker, so it starts from the stored note each time it opens.
 * @param props.target The marker and where it sits on screen.
 */
function NoteForm({ target }: { target: NoteTarget }) {
  const { all, numberOf } = useReportComments();
  const comment = all.find((entry) => entry.id === target.commentId);
  const [text, setText] = useState(comment?.marks?.[target.index]?.note ?? '');
  const [missing, setMissing] = useState(false);
  if (!comment) return null;
  const save = () => {
    if (!text.trim()) {
      setMissing(true);
      return;
    }
    saveNote(comment.id, target.index, text.trim());
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field data-invalid={missing || undefined}>
        <FieldLabel htmlFor="marker-note">Note for marker {target.index + 1}</FieldLabel>
        <Input
          id="marker-note"
          autoFocus
          value={text}
          aria-invalid={missing || undefined}
          placeholder="What this number points out"
          onChange={(event) => {
            setText(event.target.value);
            setMissing(false);
          }}
        />
        <FieldDescription>{missing ? 'Write a note, or remove the marker.' : target.fresh ? 'A marker without a note is removed.' : ''}</FieldDescription>
      </Field>
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeNoted(comment, numberOf(comment))}>
          Remove marker
        </Button>
        <Button type="submit" size="sm">
          Save note
        </Button>
      </div>
    </form>
  );
}

/** The note box beside a marker just placed or being edited, anchored at the marker. */
export function MarkerNote() {
  const note = useReportUi((state) => state.note);
  return (
    <Popover open={Boolean(note)} onOpenChange={(open) => !open && closeNote()}>
      <PopoverTrigger
        nativeButton={false}
        render={<span aria-hidden="true" className="pointer-events-none fixed size-0" style={{ left: note?.x ?? 0, top: note?.y ?? 0 }} />}
      />
      <PopoverContent side="bottom" align="start" sideOffset={16} className="w-80">
        {note && <NoteForm key={`${note.commentId}:${note.index}`} target={note} />}
      </PopoverContent>
    </Popover>
  );
}
