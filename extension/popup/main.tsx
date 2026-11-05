/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { flushDeletesOnClose } from './actions';
import { App } from './app';
import { loadFirstPaint, queryClient, watchStorage } from './queries';
import { startTheme } from './theme';
import './popup.css';

/** Applies the theme and loads everything the popup shows, then renders it once at its full size. */
async function start() {
  await Promise.all([startTheme(), loadFirstPaint()]);
  watchStorage();
  flushDeletesOnClose();
  const root = document.getElementById('root');
  if (!root) throw new Error('The popup page has no root element');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <App />
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

await start();
