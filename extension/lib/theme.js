/**
 * The colour theme for Margin's own pages. "Match system" is the default.
 * Light and dark are fixed choices in Help and settings.
 */
export const THEME_KEY = 'theme';
export const THEMES = [
  { key: 'system', label: 'Match system' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

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
  systemDark.addEventListener('change', () => choice !== 'dark' && choice !== 'light' && paint());
}
