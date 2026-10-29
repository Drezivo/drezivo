import { describe, expect, it } from 'vitest';

import { mediaUrl } from '../src/common/media.js';

const fileId = 'f364c473-ccb9-4ff5-aece-76bac163e3af';
const branchId = 'ee275186-8b37-4f90-ae64-e110aebccc5a';

describe('mediaUrl', () => {
  it('accepts branch-scoped staff media routes with supported widths', () => {
    for (const width of [320, 960, 1600]) {
      expect(mediaUrl.safeParse(`/api/media/staff/${fileId}?branch_id=${branchId}&w=${width}`).success).toBe(
        true,
      );
    }
  });

  it('accepts staff and public routes without an optimization width', () => {
    expect(mediaUrl.safeParse(`/api/media/staff/${fileId}?branch_id=${branchId}`).success).toBe(true);
    expect(mediaUrl.safeParse(`/api/media/public/drezivo/${fileId}`).success).toBe(true);
    expect(mediaUrl.safeParse(`/api/media/preview/drezivo/${fileId}`).success).toBe(true);
    expect(mediaUrl.safeParse(`/s/drezivo/media/preview/${fileId}?w=960`).success).toBe(true);
  });

  it('accepts public and preview image routes with supported widths', () => {
    for (const route of ['public', 'preview']) {
      for (const width of [320, 960, 1600]) {
        expect(mediaUrl.safeParse(`/api/media/${route}/drezivo/${fileId}?w=${width}`).success).toBe(true);
      }
    }
  });

  it('rejects unscoped staff routes and unrecognized query parameters', () => {
    expect(mediaUrl.safeParse(`/api/media/staff/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`/api/media/staff/${fileId}?branch_id=${branchId}&w=400`).success).toBe(false);
    expect(mediaUrl.safeParse(`/api/media/public/drezivo/${fileId}?w=960&other=true`).success).toBe(false);
  });
});
