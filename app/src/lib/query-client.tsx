"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Reads retry a bounded number of times (a GET is naturally idempotent). Mutations never
 * auto-retry: TRD §4's idempotency contract treats a retry as a deliberate, key-carrying
 * user/hook action (see lib/use-submit-guard.ts), not something TanStack Query should do
 * silently after a network blip — an automatic mutation retry could double-submit a POST
 * that already reached the server before the response came back.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
