import { DEFAULT_FIELDS, FACT_FIELDS, withDefaults } from './fields.js';
import { STATUSES } from './status.js';

const ALL_STATUSES = STATUSES.map((s) => s.key);
/**
 * Every detail field turned on or off.
 * @param {boolean} on True to turn them on.
 */
const allFields = (on) => Object.fromEntries(FACT_FIELDS.map((f) => [f.key, on]));

/**
 * What every export includes and how the Docs and Word export is laid out.
 * Tables default to landscape, which gives the comment column room for readable screenshots.
 */
export const DEFAULT_EXPORT_CONFIG = {
  preset: 'full',
  docLayout: 'table',
  orientation: 'landscape',
  shots: 'both',
  widths: true,
  summary: true,
  statuses: ALL_STATUSES,
  columns: { severity: true, status: true, jira: true },
  fields: DEFAULT_FIELDS,
};

/** Ready made configurations. Each sets every option, so picking one gives the same export every time. */
export const EXPORT_PRESETS = {
  full: {
    label: 'Full review',
    description: 'Every comment with its images, details and summary.',
    config: { ...DEFAULT_EXPORT_CONFIG },
  },
  developer: {
    label: 'Developer handoff',
    description: 'Open comments in a table with every technical detail.',
    config: { ...DEFAULT_EXPORT_CONFIG, preset: 'developer', fields: allFields(true), statuses: ['open'] },
  },
  client: {
    label: 'Client summary',
    description: 'Open and fixed comments as cards, without technical details or Jira.',
    config: {
      ...DEFAULT_EXPORT_CONFIG,
      preset: 'client',
      docLayout: 'cards',
      orientation: 'portrait',
      statuses: ['open', 'fixed'],
      columns: { severity: true, status: true, jira: false },
      fields: { ...allFields(false), page: true, figma: true },
    },
  },
};

/** The label the settings show once any option differs from the preset picked. */
export const CUSTOM_PRESET = { key: 'custom', label: 'Custom', description: 'Your own choice of what to include.' };

/**
 * A full configuration from a partial one, with nested defaults filled in and unknown statuses dropped.
 * @param {object} [partial] Some or all of the configuration.
 */
export function withExportDefaults(partial = {}) {
  const config = { ...DEFAULT_EXPORT_CONFIG, ...partial };
  return {
    ...config,
    statuses: Array.isArray(config.statuses) ? ALL_STATUSES.filter((s) => config.statuses.includes(s)) : ALL_STATUSES,
    columns: { ...DEFAULT_EXPORT_CONFIG.columns, ...(partial.columns ?? {}) },
    fields: withDefaults(partial.fields),
  };
}

/**
 * The configuration of a preset.
 * @param {string} key The preset key.
 */
export function applyPreset(key) {
  return withExportDefaults(EXPORT_PRESETS[key]?.config ?? DEFAULT_EXPORT_CONFIG);
}

/**
 * The configuration with some options changed, which makes it a custom one.
 * @param {object} config The current configuration.
 * @param {object} patch The options changed.
 */
export function editExportConfig(config, patch) {
  return withExportDefaults({ ...config, ...patch, preset: 'custom' });
}

/** Reads the stored configuration, moving the older separate settings into it the first time. */
export async function readExportConfig() {
  const stored = await chrome.storage.local.get(['exportConfig', 'shotMode', 'widthMode', 'fields']);
  if (stored.exportConfig) return withExportDefaults(stored.exportConfig);
  const legacy = 'shotMode' in stored || 'widthMode' in stored || 'fields' in stored;
  const config = withExportDefaults(
    legacy
      ? {
          preset: 'custom',
          ...(stored.shotMode ? { shots: stored.shotMode } : {}),
          ...(stored.widthMode ? { widths: stored.widthMode === 'show' } : {}),
          ...(stored.fields ? { fields: stored.fields } : {}),
        }
      : {},
  );
  if (legacy) {
    await chrome.storage.local.set({ exportConfig: config });
    await chrome.storage.local.remove(['shotMode', 'widthMode', 'fields']);
  }
  return config;
}

/**
 * Stores the configuration.
 * @param {object} config The configuration to keep.
 */
export async function writeExportConfig(config) {
  const next = withExportDefaults(config);
  await chrome.storage.local.set({ exportConfig: next });
  return next;
}

/**
 * The export options every format reads: the configuration, given either flat or as `config`, with defaults filled in.
 * The older option names `shots`, `widths` and `fields` are the same keys, so callers that pass them keep working.
 * @param {object} [options] The options a format was called with.
 */
export function exportOptions(options = {}) {
  const { config, ...rest } = options;
  const picked = Object.fromEntries(Object.keys(DEFAULT_EXPORT_CONFIG).filter((key) => rest[key] !== undefined).map((key) => [key, rest[key]]));
  return { ...rest, ...withExportDefaults({ ...(config ?? {}), ...picked }) };
}
