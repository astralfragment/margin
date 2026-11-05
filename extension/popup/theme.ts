import type { ThemeChoice } from '@/lib/model';
import { themeItem } from '@/lib/storage';

const systemDark = matchMedia('(prefers-color-scheme: dark)');

let choice: ThemeChoice = 'system';

/** Sets data-theme on the page from the stored choice, following the system when the choice is system. */
function paint() {
  const dark = choice === 'dark' || (choice === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/**
 * Applies the theme before the popup renders, then keeps it in step with the setting and the system.
 * The system theme is painted at once, so the first frame already matches when nothing else is chosen.
 */
export async function startTheme() {
  paint();
  choice = await themeItem.getValue();
  paint();
  themeItem.watch((next) => {
    choice = next ?? 'system';
    paint();
  });
  systemDark.addEventListener('change', paint);
}
