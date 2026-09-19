/**
 * Parse the comma-separated browser origins accepted by the API.
 *
 * Origins are normalized through URL parsing, but path-bearing, wildcard, and
 * credential-bearing values are rejected so the allowlist cannot accidentally
 * become broader than intended.
 */
export function parseCorsAllowedOrigins(value: string): string[] {
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain non-empty comma-separated origins');
  }

  const origins: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.includes('*')) {
      throw new Error('CORS_ALLOWED_ORIGINS does not allow wildcards');
    }

    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${entry}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an unsupported protocol: ${entry}`);
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`CORS_ALLOWED_ORIGINS must contain origins only: ${entry}`);
    }

    const normalized = parsed.origin;
    if (seen.has(normalized)) {
      throw new Error(`CORS_ALLOWED_ORIGINS contains a duplicate origin: ${normalized}`);
    }
    seen.add(normalized);
    origins.push(normalized);
  }

  return origins;
}
