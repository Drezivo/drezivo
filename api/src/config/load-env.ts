import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Loads API-local environment files before config validation.
 *
 * Precedence is intentionally deterministic and fails closed: host/CI variables win over every
 * file; then the selected `.env.<NODE_ENV>` and shared `.env` values are considered for local
 * development/test. Production and staging skip the shared developer `.env`, which may contain
 * local MinIO settings; only explicitly selected
 * `.env.<mode>` files are loaded in those environments. Values are parsed only; this module never
 * logs a path's contents or any secret.
 */
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseFile(filename: string): Record<string, string> {
  const filePath = resolve(apiRoot, filename);
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = parseEnv(readFileSync(filePath, 'utf8'));
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

const shared = parseFile('.env');
const mode = process.env.NODE_ENV ?? shared.NODE_ENV ?? 'development';
process.env.NODE_ENV ??= mode;
const layered = {
  ...(mode === 'production' || mode === 'staging' ? {} : shared),
  ...parseFile(`.env.${mode}`),
};

for (const [key, value] of Object.entries(layered)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
