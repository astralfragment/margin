/**
 * The colour theme for Margin's own pages. Light is the default. Dark and
 * "match system" are opt in from Help and settings.
 */
export const THEME_KEY = 'theme';
export const THEMES = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'Match system' },
];

const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Resolves a stored theme choice to the theme that is actually shown.
 * @param {string | undefined} choice The stored choice, light when unset.
 */
function resolve(choice) {
  if (choice === 'dark') return 'dark';
  if (choice === 'system') return systemDark.matches ? 'dark' : 'light';
  return 'light';
}

/**
 * Applies the stored theme to this page and keeps it in step with later changes to the setting or, for "match system", the OS.
 * @param {(theme: 'light' | 'dark') => void} [onChange] Called with the shown theme each time it is applied, for documents the page draws itself, such as the report preview.
 */
export async function applyTheme(onChange) {
  let choice = (await chrome.storage.local.get(THEME_KEY))[THEME_KEY];
  const paint = () => {
    const theme = resolve(choice);
    document.documentElement.dataset.theme = theme;
    onChange?.(theme);
  };
  paint();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(THEME_KEY in changes)) return;
    choice = changes[THEME_KEY].newValue;
    paint();
  });
  systemDark.addEventListener('change', () => choice === 'system' && paint());
}
