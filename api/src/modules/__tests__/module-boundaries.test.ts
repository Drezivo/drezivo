import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulesRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function collectLayerFiles(directory: string, suffix: '.routes.ts' | '.controller.ts'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectLayerFiles(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

describe('backend module boundaries', () => {
  it('keeps routes free of persistence and provider imports', () => {
    for (const file of collectLayerFiles(modulesRoot, '.routes.ts')) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"].*(?:db\/|\.repository|@clerk\/|drizzle-orm)/);
    }
  });

  it('keeps controllers free of persistence and provider imports', () => {
    for (const file of collectLayerFiles(modulesRoot, '.controller.ts')) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"].*(?:db\/|\.repository|@clerk\/|drizzle-orm)/);
    }
  });
});
