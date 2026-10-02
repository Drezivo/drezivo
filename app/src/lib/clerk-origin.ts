/**
 * Clerk's Frontend API origin, read from the publishable key: `pk_(test|live)_` followed by the
 * base64 of `<host>$`. Returns null for anything that does not decode to a plain host name, so a
 * malformed key never produces a strange URL in the page head.
 */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.match(/^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/)?.[1];
  if (!encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null;
}
