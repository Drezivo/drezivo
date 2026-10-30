import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn() }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...original, config: { ...original.config, MEDIA_READ_GRANT_SECRET: 'g'.repeat(48) } };
});
vi.mock('../../storefront/storefront.service.js', () => ({ publicStorefrontService: { authorizeMediaRead: mocks.read } }));
vi.mock('../../storefront/storefront-preview.js', () => ({ verifyPreviewToken: mocks.verify }));
import { internalMediaRouter } from '../internal-media.routes.js';

describe('preview image grants', () => {
  it('rejects an expired or invalid preview token before checking public media', async () => {
    mocks.verify.mockReturnValue(null);
    const app = express();
    app.use(internalMediaRouter);
    app.use((error: { status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next;
      res.status(error.status ?? 500).end();
    });
    const response = await request(app)
      .post('/internal/media/v1/public/stores/shop/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001/grant?w=960')
      .set('X-Drezivo-Media-Grant', 'g'.repeat(48))
      .set('X-Storefront-Preview', 'expired-token');
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
