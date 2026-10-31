/**
 * The colour theme and accent colour for Margin's own pages. "Match system" and
 * lime are the defaults. Both are choices in Help and settings.
 */
export const THEME_KEY = 'theme';
export const THEMES = [
  { key: 'system', label: 'Match system' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export const ACCENT_KEY = 'accent';
/** Swatches show the light theme value. Labels are what people pick from. */
export const ACCENTS = [
  { key: 'lime', label: 'Lime', swatch: '#c1f354' },
  { key: 'neutral', label: 'Black and white', swatch: '#171717' },
  { key: 'rose', label: 'Rose', swatch: '#e11d48' },
  { key: 'orange', label: 'Orange', swatch: '#f97316' },
  { key: 'teal', label: 'Teal', swatch: '#2dd4bf' },
];

/** The stored accent, lime when unset or unknown. */
export const resolveAccent = (choice) => (ACCENTS.some((a) => a.key === choice) ? choice : 'lime');

const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Resolves a stored theme choice to the theme that is actually shown.
 * @param {string | undefined} choice The stored choice, "match system" when unset.
 */
function resolve(choice) {
  if (choice === 'dark' || choice === 'light') return choice;
  return systemDark.matches ? 'dark' : 'light';
}

/**
 * Applies the stored theme to this page and keeps it in step with later changes to the setting or, for "match system", the OS.
 * @param {(theme: 'light' | 'dark') => void} [onChange] Called with the shown theme each time it is applied, for documents the page draws itself, such as the report preview.
 */
export async function applyTheme(onChange) {
  const stored = await chrome.storage.local.get([THEME_KEY, ACCENT_KEY]);
  let choice = stored[THEME_KEY];
  document.documentElement.dataset.accent = resolveAccent(stored[ACCENT_KEY]);
  const paint = () => {
    const theme = resolve(choice);
    document.documentElement.dataset.theme = theme;
    onChange?.(theme);
  };
  paint();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (ACCENT_KEY in changes) document.documentElement.dataset.accent = resolveAccent(changes[ACCENT_KEY].newValue);
    if (!(THEME_KEY in changes)) return;
    choice = changes[THEME_KEY].newValue;
    paint();
  });
  systemDark.addEventListener('change', () => choice !== 'dark' && choice !== 'light' && paint());
}
