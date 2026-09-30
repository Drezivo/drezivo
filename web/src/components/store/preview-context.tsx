'use client';

import { createContext, useContext } from 'react';

const PreviewContext = createContext(false);

/** True while the owner is previewing an unpublished storefront; bookings and fitting requests stay off. */
export function PreviewProvider({ preview, children }: { preview: boolean; children: React.ReactNode }) {
  return <PreviewContext.Provider value={preview}>{children}</PreviewContext.Provider>;
}

export function useStorePreview(): boolean {
  return useContext(PreviewContext);
}
