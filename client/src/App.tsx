import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from './features/auth/AuthProvider';
import { createQueryClient } from './queryClient';
import { AppRoutes } from './routes';
import { ErrorBoundary } from './ui/ErrorBoundary';

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary onRetry={() => queryClient.resetQueries()}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
  );
}
