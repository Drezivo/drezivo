import { describe, expect, it } from 'vitest';

import {
  LOCAL_CLOTHING_SEED,
  buildLocalClothingRequest,
  canRunLocalClothingSeed,
  isLoopbackPostgresUrl,
  parseLocalSeedArguments,
} from '../../scripts/seed-local-clothing-data.js';

describe('local clothing seed data', () => {
  it('contains exactly 20 uniquely coded synthetic styles', () => {
    expect(LOCAL_CLOTHING_SEED).toHaveLength(20);
    expect(new Set(LOCAL_CLOTHING_SEED.map((item) => item.code)).size).toBe(20);
    expect(LOCAL_CLOTHING_SEED.every((item) => item.code.startsWith('LOCAL-SEED-'))).toBe(true);
  });

  it('builds valid draft requests with no attached images', () => {
    for (const item of LOCAL_CLOTHING_SEED) {
      const request = buildLocalClothingRequest(item, '00000000-0000-4000-8000-000000000001');
      expect(request.activate).toBe(false);
      expect(request.image_file_ids).toEqual([]);
      expect(request.sizes).toHaveLength(1);
      expect(request.sizing_mode).toBe(item.sizeLabel === null ? 'free_size' : 'sized');
      expect(request.code).toBe(item.code);
    }
  });

  it('requires a storefront slug and defaults to a read-only preview', () => {
    expect(() => parseLocalSeedArguments([])).toThrow('--storefront-slug is required');
    expect(parseLocalSeedArguments(['--storefront-slug', 'my-rental'])).toEqual({
      storefrontSlug: 'my-rental',
      apply: false,
      help: false,
    });
    expect(parseLocalSeedArguments(['--storefront-slug', 'my-rental', '--apply']).apply).toBe(true);
    expect(() => parseLocalSeedArguments(['--storefront-slug', 'My Rental'])).toThrow(
      'lowercase letters',
    );
    expect(() => parseLocalSeedArguments(['--storefront-slug'])).toThrow('requires a value');
    expect(parseLocalSeedArguments(['--help'])).toEqual({
      storefrontSlug: '',
      apply: false,
      help: true,
    });
  });

  it('accepts only loopback PostgreSQL URLs for the local target', () => {
    expect(isLoopbackPostgresUrl('postgresql://drezivo:local@127.0.0.1:5432/drezivo')).toBe(true);
    expect(isLoopbackPostgresUrl('postgres://drezivo:local@localhost/drezivo')).toBe(true);
    expect(isLoopbackPostgresUrl('postgres://drezivo:local@[::1]/drezivo')).toBe(true);
    expect(isLoopbackPostgresUrl('postgres://user:secret@db.example.com/drezivo')).toBe(false);
    expect(isLoopbackPostgresUrl('not-a-url')).toBe(false);
  });

  it('refuses non-development environments even when their database URL is loopback', () => {
    expect(
      canRunLocalClothingSeed('development', 'postgres://drezivo:local@127.0.0.1/drezivo'),
    ).toBe(true);
    expect(canRunLocalClothingSeed('staging', 'postgres://drezivo:local@127.0.0.1/drezivo')).toBe(
      false,
    );
    expect(
      canRunLocalClothingSeed('development', 'postgres://user:secret@db.example.com/drezivo'),
    ).toBe(false);
  });
});
