import type { ThemeChoice } from '@/lib/model';
import { themeItem } from '@/lib/storage';

const systemDark = matchMedia('(prefers-color-scheme: dark)');
let choice: ThemeChoice = 'system';

/** Sets the page theme from the stored choice, resolving system against the OS setting. */
function paint() {
  const dark = choice === 'dark' || (choice === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Applies the stored theme now and keeps the page in step with the setting and, for system, with the OS. */
export async function followTheme() {
  paint();
  choice = await themeItem.getValue();
  paint();
  themeItem.watch((next) => {
    choice = next ?? 'system';
    paint();
  });
  systemDark.addEventListener('change', paint);
}
