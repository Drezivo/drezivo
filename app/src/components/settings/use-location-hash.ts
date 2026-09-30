"use client";

import { useSyncExternalStore } from "react";

/** Clerk's UserProfile uses hash routing: `#/` is the profile page and `#/security` the security page. */
export const PROFILE_HASH = "#/";
export const SECURITY_HASH = "#/security";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The current hash, with an empty hash reported as the profile page. */
export function useLocationHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => (window.location.hash.length > 1 ? window.location.hash : PROFILE_HASH),
    () => PROFILE_HASH,
  );
}
