import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Loads API-local environment files before config validation.
 *
 * Precedence is intentionally deterministic and fails closed: host/CI variables win over every
 * file; then a mounted DREZIVO_ENV_FILE; then the selected `.env.<NODE_ENV>` and shared `.env`
 * values are considered for local development/test. Production and staging deliberately skip the
 * shared developer `.env`, so local MinIO or test-R2 credentials cannot leak into deployment.
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

/**
 * A deployment can keep all of its secrets in ONE secret-manager entry mounted as a file (for
 * example Cloud Run's Secret Manager volume at /secrets/worker.env) and point DREZIVO_ENV_FILE at
 * it: one secret read per start instead of one per variable. Read in every mode. A named file
 * that is missing stops startup, because silently running without its secrets would be worse.
 */
function mountedFile(): Record<string, string> {
  const filePath = process.env.DREZIVO_ENV_FILE;
  if (!filePath) return {};
  if (!existsSync(filePath)) {
    throw new Error('DREZIVO_ENV_FILE points at a file that does not exist.');
  }
  return parseFile(filePath);
}

const shared = parseFile('.env');
const mode = process.env.NODE_ENV ?? shared.NODE_ENV ?? 'development';
process.env.NODE_ENV ??= mode;
const layered = {
  ...(mode === 'production' || mode === 'staging' ? {} : shared),
  ...parseFile(`.env.${mode}`),
  ...mountedFile(),
};

for (const [key, value] of Object.entries(layered)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
