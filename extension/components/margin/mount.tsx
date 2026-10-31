import '@/assets/tailwind.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient, watchStorage } from '@/lib/query';
import { applyTheme } from '@/lib/theme.js';

/** Applies Margin's theme, connects storage changes to the query cache, and renders a page into its #root element. */
export function mountPage(page: ReactNode) {
  applyTheme();
  watchStorage();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>{page}</QueryClientProvider>
    </StrictMode>,
  );
}
