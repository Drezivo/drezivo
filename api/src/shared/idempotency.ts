import { createHash } from 'node:crypto';

/** Deterministic SHA-256 hash over a request body, independent of object key ordering. */
export function canonicalRequestHash(body: unknown): string {
  const canonical = JSON.stringify(sortKeysDeep(body));
  return createHash('sha256').update(canonical).digest('hex');
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortKeysDeep(record[key]);
        return accumulator;
      }, {});
  }
  return value;
}
