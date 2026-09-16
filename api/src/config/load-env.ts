import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Loads API-local environment files before config validation.
 *
 * Precedence is intentionally deterministic and fails closed: host/CI variables win over every
 * file; then the selected `.env.<NODE_ENV>` and shared `.env` values are considered for local
 * development/test. Production deliberately skips `.env`, which is the developer's local file,
 * so its MinIO endpoint and credentials cannot leak into a deployment.
 * Values are parsed only; this module never logs a path's contents or any secret.
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
const layered = {
  ...(mode === 'production' ? {} : shared),
  ...parseFile(`.env.${mode}`),
};

for (const [key, value] of Object.entries(layered)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
