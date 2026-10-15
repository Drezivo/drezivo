"use client";

/**
 * One-shot hand-off from the post-sign-in resolver to the dashboard access gate.
 *
 * The resolver lists the account's workspaces, picks one and activates it in Clerk, then reloads
 * into the dashboard. Without this note the gate repeated that whole resolution seconds later. The
 * note only lets the gate skip the routing decision; it still loads the actor context from the API,
 * which authorizes the request itself, so a stale or forged note cannot grant access. It holds no
 * personal data: the Clerk organization id and a timestamp.
 */
const KEY = "drezivo:workspace-resolved";
const MAX_AGE_MS = 60_000;

export function rememberResolvedWorkspace(clerkOrgId: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ clerkOrgId, at: Date.now() }));
  } catch {
    // Storage unavailable (private mode, blocked site data): the gate simply resolves again.
  }
}

/** True once, when the resolver just resolved this same organization in this tab. */
export function takeResolvedWorkspace(clerkOrgId: string | null | undefined): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw || !clerkOrgId) return false;
    const note = JSON.parse(raw) as { clerkOrgId?: unknown; at?: unknown };
    return (
      note.clerkOrgId === clerkOrgId &&
      typeof note.at === "number" &&
      Date.now() - note.at >= 0 &&
      Date.now() - note.at < MAX_AGE_MS
    );
  } catch {
    return false;
  }
}
