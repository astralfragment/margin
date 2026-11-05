import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { FACT_FIELDS } from './shared';
import { factFieldsItem, shotModeItem, widthModeItem } from '@/lib/storage';
import type { FactField, ShotMode } from '@/lib/model';
import { queryClient, useSettings, type ReportSettings } from './data';
import { closeDialog, useReportUi } from './ui-store';

const SHOT_CHOICES: { value: ShotMode; label: string }[] = [
  { value: 'both', label: 'Close-up and full screen' },
  { value: 'detail', label: 'Close-up only' },
  { value: 'viewport', label: 'Full screen only' },
];

/** Each detail named the way a reader would recognise it under a comment. */
const FIELD_LABELS: Record<FactField, string> = {
  page: 'Page title and address',
  figma: 'Figma links',
  jira: 'Jira issue',
  selector: 'Selector to find it in code',
  element: 'Element tag and classes',
  text: 'Text in the element',
  styles: 'Font and text colour',
  position: 'Size and position',
  captured: 'Date and time',
  browser: 'Browser and zoom',
};

/**
 * Stores the report options, which the report, the copies and every export read.
 * @param next The options picked.
 */
async function saveSettings(next: ReportSettings) {
  await Promise.all([factFieldsItem.setValue(next.fields), shotModeItem.setValue(next.shots), widthModeItem.setValue(next.widths ? 'show' : 'hide')]);
  queryClient.setQueryData(['settings'], next);
}

/**
 * The form, which starts from the stored options each time the dialog opens.
 * @param props.initial The stored options.
 */
function OptionsForm({ initial }: { initial: ReportSettings }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      className="grid min-h-0 gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await saveSettings(draft);
          closeDialog();
          toast.success('Report options saved');
        } catch (error) {
          toast.error(`The options were not saved. ${error instanceof Error ? error.message : String(error)}`);
        }
      }}
    >
      <div className="-mx-6 grid min-h-0 gap-6 overflow-x-hidden overflow-y-auto px-6 pb-2">
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-1">
            Screenshots
          </FieldLegend>
          <FieldDescription>The close-up is the marked area. Full screen is everything that was on screen.</FieldDescription>
          <RadioGroup value={draft.shots} onValueChange={(value) => setDraft({ ...draft, shots: value as ShotMode })} className="gap-3 sm:grid-cols-3">
            {SHOT_CHOICES.map((choice) => (
              <label key={choice.value} className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <RadioGroupItem value={choice.value} />
                {choice.label}
              </label>
            ))}
          </RadioGroup>
        </FieldSet>
        <Separator />
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Mobile, tablet and desktop shots</span>
            <span className="text-sm text-muted-foreground">For comments captured at three screen widths.</span>
          </span>
          <Switch checked={draft.widths} onCheckedChange={(checked) => setDraft({ ...draft, widths: checked })} className="mt-0.5" />
        </label>
        <Separator />
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-1">
            Details under each comment
          </FieldLegend>
          <FieldDescription>Untick the ones your readers do not need.</FieldDescription>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {FACT_FIELDS.map((field) => (
              <label key={field.key} className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <Checkbox
                  checked={draft.fields[field.key as FactField]}
                  onCheckedChange={(checked) => setDraft({ ...draft, fields: { ...draft.fields, [field.key]: checked === true } })}
                />
                {FIELD_LABELS[field.key as FactField] ?? field.label}
              </label>
            ))}
          </div>
        </FieldSet>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeDialog}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}

/** Report options: which screenshots, whether width shots show, and which details sit under each comment. */
export function OptionsDialog() {
  const open = useReportUi((state) => state.dialog === 'options');
  const settings = useSettings().data;
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent ref={popup} initialFocus={popup} className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle>Report options</DialogTitle>
          <DialogDescription>What each comment shows, here and in every copy and download.</DialogDescription>
        </DialogHeader>
        {open && settings && <OptionsForm initial={settings} />}
      </DialogContent>
    </Dialog>
  );
}
