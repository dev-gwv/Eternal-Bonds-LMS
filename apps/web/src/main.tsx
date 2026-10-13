import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './shared/ui/Toast.tsx';
import { Motion } from './shared/ui/motion.tsx';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router.tsx';
import { SessionProvider } from './shared/session.tsx';
import { isNotFound } from './shared/api.ts';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // One retry for a flaky connection; none for a 404, which will not
      // change on a second ask and only delays the "not found" page.
      retry: (failures, error) => !isNotFound(error) && failures < 1,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        {/* Outside the router so a toast survives navigation — "Saved" should
            still be on screen when the save was the thing that navigated. */}
        <Motion>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </Motion>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
