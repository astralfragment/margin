import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FACT_FIELDS } from './shared';
import { factFieldsItem, shotModeItem, widthModeItem } from '@/lib/storage';
import type { FactField, ShotMode } from '@/lib/model';
import { queryClient, useSettings, type ReportSettings } from './data';
import { closeDialog, useReportUi } from './ui-store';

const SHOT_ITEMS = [
  { value: 'both', label: 'Both images' },
  { value: 'detail', label: 'Marked region only' },
  { value: 'viewport', label: 'Full viewport only' },
];

const WIDTH_ITEMS = [
  { value: 'show', label: 'Include' },
  { value: 'hide', label: 'Leave out' },
];

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
      className="grid gap-5"
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Screenshots</FieldLabel>
          <Select items={SHOT_ITEMS} value={draft.shots} onValueChange={(value) => value && setDraft({ ...draft, shots: value as ShotMode })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Mobile, tablet and desktop</FieldLabel>
          <Select items={WIDTH_ITEMS} value={draft.widths ? 'show' : 'hide'} onValueChange={(value) => setDraft({ ...draft, widths: value === 'show' })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTH_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <FieldSet>
        <FieldLegend variant="label">Details under each comment</FieldLegend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {FACT_FIELDS.map((field) => (
            <Field key={field.key} orientation="horizontal">
              <Checkbox
                id={`field-${field.key}`}
                checked={draft.fields[field.key as FactField]}
                onCheckedChange={(checked) => setDraft({ ...draft, fields: { ...draft.fields, [field.key]: checked === true } })}
              />
              <FieldLabel htmlFor={`field-${field.key}`} className="font-normal">
                {field.label}
              </FieldLabel>
            </Field>
          ))}
        </div>
      </FieldSet>
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report options</DialogTitle>
          <DialogDescription>Applies to the report, the copies and every export</DialogDescription>
        </DialogHeader>
        {open && settings && <OptionsForm initial={settings} />}
      </DialogContent>
    </Dialog>
  );
}
