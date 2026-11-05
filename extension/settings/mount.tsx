import '@/assets/tailwind.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { preloadPage, queryClient } from './queries';
import { followTheme } from './theme';

/**
 * Applies the theme, reads the stored settings, then renders the page, or says what failed to load.
 * @param page The page to render.
 */
export async function mountPage(page: ReactNode) {
  const root = createRoot(document.getElementById('root')!);
  try {
    await followTheme();
    await preloadPage();
  } catch (error) {
    console.error('Margin: the page could not read its settings', error);
    root.render(
      <Alert variant="destructive" className="m-4 w-auto">
        <AlertTitle>Margin could not read its settings</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
      </Alert>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Suspense>{page}</Suspense>
      </QueryClientProvider>
    </StrictMode>,
  );
}
