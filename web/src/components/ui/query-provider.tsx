'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * One QueryClient per browser tab, created lazily inside state so React
 * Strict Mode's double-invoke in development doesn't spin up two clients,
 * and so a server-rendered request never shares a client across visitors.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Availability and catalog reads are explicitly advisory and
            // short-lived (Drezivo-TRD.md §5) — a long client-side cache
            // would show a customer a stale "available" day.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
