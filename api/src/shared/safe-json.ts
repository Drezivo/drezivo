import { ValidationError } from './errors.js';

export const SAFE_JSON_MAX_BYTES = 64 * 1024;

/**
 * Validates and serializes caller-redacted JSON before it crosses a persistence boundary.
 * JSON.stringify also catches cycles and unsupported values; the repository never stores a
 * partially serialized or unbounded response/summary.
 */
export function serializeBoundedJson(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable.`);
  }
  if (serialized === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > SAFE_JSON_MAX_BYTES) {
    throw new ValidationError(`${label} must not exceed ${SAFE_JSON_MAX_BYTES} bytes.`);
  }
  return serialized;
}
