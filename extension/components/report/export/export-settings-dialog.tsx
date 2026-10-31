import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FACT_FIELDS } from '@/lib/fields.js';
import { CUSTOM_PRESET, applyPreset, editExportConfig } from '@/lib/export-config.js';
import { STATUSES } from '@/lib/status.js';
import { cn } from '@/lib/utils';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { useSaveExportConfig } from '../queries';
import { PRESETS, exportSummary, type ExportConfig, type StatusKey } from './config';

const SHOTS = [
  { value: 'both', label: 'Region and viewport' },
  { value: 'detail', label: 'Marked region' },
  { value: 'viewport', label: 'Full viewport' },
  { value: 'none', label: 'None' },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ExportConfig;
  counts: Record<StatusKey, number>;
};

/** Picks a preset or sets each option, with a live line saying what the next export will hold. */
export function ExportSettingsDialog({ open, onOpenChange, config, counts }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-2xl">
        <Settings config={config} counts={counts} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The form, mounted each time the dialog opens, so it starts from the saved settings. */
function Settings({ config, counts, onClose }: { config: ExportConfig; counts: Record<StatusKey, number>; onClose: () => void }) {
  const [draft, setDraft] = useState(config);
  const saveConfig = useSaveExportConfig();

  const change = (patch: Partial<ExportConfig>) => setDraft((d) => editExportConfig(d, patch) as ExportConfig);
  const pickPreset = (key: string) => setDraft((d) => (key === CUSTOM_PRESET.key ? (editExportConfig(d, {}) as ExportConfig) : (applyPreset(key) as ExportConfig)));
  const toggleStatus = (key: StatusKey, on: boolean) =>
    change({ statuses: (STATUSES as { key: StatusKey }[]).map((s) => s.key).filter((k) => (k === key ? on : draft.statuses.includes(k))) });

  const save = async () => {
    await saveConfig.mutateAsync(draft);
    onClose();
    toast.success('Export settings saved');
  };

  return (
    <>
      <DialogHeader className="border-b p-5">
        <DialogTitle>Export settings</DialogTitle>
        <DialogDescription>What the copies, the files and Send to Jira include. The preview always shows every comment.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-7 overflow-y-auto p-5">
        <RadioGroup value={draft.preset} onValueChange={pickPreset} aria-label="Preset" className="grid gap-2 sm:grid-cols-2">
          {[...PRESETS, CUSTOM_PRESET].map((preset) => (
            <label
              key={preset.key}
              className={cn(
                'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/60',
                draft.preset === preset.key ? 'border-primary bg-muted/60' : 'border-border',
              )}
            >
              <RadioGroupItem value={preset.key} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold">{preset.label}</span>
                <span className="text-sm leading-snug text-muted-foreground">{preset.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <div className="grid gap-7 sm:grid-cols-2">
          <Group title="Layout">
            <Row label="Google Docs and Word">
              <ToggleGroup value={[draft.docLayout]} onValueChange={(v) => v[0] && change({ docLayout: v[0] as ExportConfig['docLayout'] })} aria-label="Docs layout">
                <ToggleGroupItem value="table">Table</ToggleGroupItem>
                <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
              </ToggleGroup>
            </Row>
            <Row label="Page">
              <ToggleGroup value={[draft.orientation]} onValueChange={(v) => v[0] && change({ orientation: v[0] as ExportConfig['orientation'] })} aria-label="Page orientation">
                <ToggleGroupItem value="landscape">Landscape</ToggleGroupItem>
                <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </Group>

          <Group title="Content">
            <Row label="Screenshots">
              <Select value={draft.shots} onValueChange={(v) => v && change({ shots: v as ExportConfig['shots'] })} items={SHOTS}>
                <SelectTrigger aria-label="Screenshots" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Check checked={draft.widths} onChange={(widths) => change({ widths })} label="Mobile, tablet and desktop shots" />
            <Check checked={draft.summary} onChange={(summary) => change({ summary })} label="Cover and summary" />
          </Group>

          <Group title="Comments to include">
            {(STATUSES as { key: StatusKey; label: string }[]).map((s) => (
              <Check key={s.key} checked={draft.statuses.includes(s.key)} onChange={(on) => toggleStatus(s.key, on)} label={s.label} hint={`${counts[s.key] ?? 0}`} />
            ))}
          </Group>

          <Group title="Docs table columns" note={draft.docLayout === 'cards' ? 'Used when the layout is Table.' : undefined}>
            {(['severity', 'status', 'jira'] as const).map((key) => (
              <Check
                key={key}
                disabled={draft.docLayout === 'cards'}
                checked={draft.columns[key]}
                onChange={(on) => change({ columns: { ...draft.columns, [key]: on } })}
                label={{ severity: 'Severity', status: 'Status', jira: 'Jira key' }[key]}
              />
            ))}
          </Group>
        </div>

        <Group title="Details under each comment">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            {FACT_FIELDS.map((f: { key: string; label: string }) => (
              <Check key={f.key} checked={Boolean(draft.fields[f.key])} onChange={(on) => change({ fields: { ...draft.fields, [f.key]: on } })} label={f.label} />
            ))}
          </div>
        </Group>
      </div>
      <DialogFooter className="m-0 items-center rounded-b-xl">
        <p className="mr-auto text-sm font-medium text-muted-foreground" aria-live="polite">
          Next export: {exportSummary(draft, counts)}
        </p>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!draft.statuses.length || saveConfig.isPending}>
          Save settings
        </Button>
      </DialogFooter>
    </>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="grid content-start gap-3">
      <legend className="mb-3 text-xs font-medium text-muted-foreground">{title}</legend>
      {children}
      {note && <p className="text-sm font-medium text-muted-foreground">{note}</p>}
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex w-fit items-center gap-2.5 text-sm', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(on) => onChange(Boolean(on))} />
      {label}
      {hint && <span className="text-sm font-medium text-muted-foreground tabular-nums">{hint}</span>}
    </label>
  );
}
