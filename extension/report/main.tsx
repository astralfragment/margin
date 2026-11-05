import './report.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { followStorage, queryClient } from './data';
import { followTheme } from './theme';
import { followRecheck } from './recheck';
import { App } from './app';

followStorage();
await followTheme();
followRecheck().catch((error: unknown) => console.error('The recheck run could not be read', error));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
