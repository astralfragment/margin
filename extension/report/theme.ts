import { create } from 'zustand';
import { themeItem } from '@/lib/storage';
import type { ThemeChoice } from '@/lib/model';

type ShownTheme = 'light' | 'dark';

const systemDark = matchMedia('(prefers-color-scheme: dark)');

/** The theme the page shows, kept in step with the setting and, for the system choice, the OS. */
export const useShownTheme = create<{ choice: ThemeChoice; shown: ShownTheme }>(() => ({ choice: 'system', shown: 'light' }));

/**
 * Turns a theme choice into the theme shown.
 * @param choice The stored choice.
 */
function resolve(choice: ThemeChoice): ShownTheme {
  if (choice === 'system') return systemDark.matches ? 'dark' : 'light';
  return choice;
}

/**
 * Shows a theme choice on the page, where the dark variant in tailwind.css reads it.
 * @param choice The stored choice.
 */
function paint(choice: ThemeChoice) {
  const shown = resolve(choice);
  document.documentElement.dataset.theme = shown;
  useShownTheme.setState({ choice, shown });
}

/** Applies the stored theme and follows later changes to the setting and the OS. */
export async function followTheme() {
  paint(useShownTheme.getState().choice);
  themeItem.watch((choice) => paint(choice ?? 'system'));
  systemDark.addEventListener('change', () => paint(useShownTheme.getState().choice));
  paint(await themeItem.getValue());
}
