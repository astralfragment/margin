import '@/assets/tailwind.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@/lib/theme.js';

/** Applies Margin's theme and renders a page into its #root element. */
export function mountPage(page: ReactNode) {
  applyTheme();
  createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
}
