import { useSyncExternalStore } from 'react';

/** Margin's theme as lib/theme.js shows it, read from data-theme on the root element so React follows every change. */
export function useTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
  );
}
