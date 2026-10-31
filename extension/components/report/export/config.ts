import { EXPORT_PRESETS } from '@/lib/export-config.js';
import { plural } from '../util';

export type StatusKey = 'open' | 'fixed' | 'wontfix';

/** The export configuration lib/export-config.js stores and every export reads. */
export type ExportConfig = {
  preset: string;
  docLayout: 'table' | 'cards';
  orientation: 'landscape' | 'portrait';
  shots: 'both' | 'detail' | 'viewport' | 'none';
  widths: boolean;
  summary: boolean;
  statuses: StatusKey[];
  columns: { severity: boolean; status: boolean; jira: boolean };
  fields: Record<string, boolean>;
};

export type Preset = { key: string; label: string; description: string; config?: ExportConfig };

export const PRESETS: Preset[] = Object.entries(EXPORT_PRESETS as Record<string, Omit<Preset, 'key'>>).map(([key, preset]) => ({ key, ...preset }));

const STATUS_WORDS: Record<StatusKey, string> = { open: 'open', fixed: 'fixed', wontfix: "won't fix" };

/** What the next export will hold, in a few words: "12 comments, open only, tables, landscape". */
export function exportSummary(config: ExportConfig, counts: Record<StatusKey, number>) {
  const included = config.statuses.reduce((n, key) => n + (counts[key] ?? 0), 0);
  const all = config.statuses.length === 3;
  const which = all ? '' : config.statuses.length ? `${config.statuses.map((s) => STATUS_WORDS[s]).join(' and ')} only` : 'no statuses picked';
  const shots = { both: '', detail: 'marked regions only', viewport: 'full viewports only', none: 'no screenshots' }[config.shots];
  return [
    plural(included, 'comment', 'comments'),
    which,
    config.docLayout === 'table' ? 'tables' : 'cards',
    config.orientation,
    shots,
    config.summary ? '' : 'no summary',
  ]
    .filter(Boolean)
    .join(', ');
}
