/** Returns the environment's public website Terms URL, or null when it is not configured. */
export function publicTermsUrl(): string | null {
  const configuredOrigin = process.env["NEXT_PUBLIC_STOREFRONT_ORIGIN"]?.trim();
  if (!configuredOrigin) return null;

  try {
    const url = new URL(configuredOrigin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL("/terms", url.origin).toString();
  } catch {
    return null;
  }
}
