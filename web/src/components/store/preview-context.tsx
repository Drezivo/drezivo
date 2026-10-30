'use client';

import { createContext, useContext } from 'react';

const PreviewContext = createContext({ preview: false, mediaSession: undefined as string | undefined });

/** True while the owner is previewing an unpublished storefront; bookings and fitting requests stay off. */
export function PreviewProvider({
  preview,
  mediaSession,
  children,
}: {
  preview: boolean;
  mediaSession?: string;
  children: React.ReactNode;
}) {
  return <PreviewContext.Provider value={{ preview, mediaSession }}>{children}</PreviewContext.Provider>;
}

export function useStorePreview(): boolean {
  return useContext(PreviewContext).preview;
}

export function useStorePreviewMediaSession(): string | undefined {
  return useContext(PreviewContext).mediaSession;
}
