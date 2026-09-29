import { Router } from 'express';

import {
  publishStorefrontPolicyRequest,
  storefrontTransitionRequest,
  updateStorefrontRequest,
  updateStorefrontSlugRequest,
  type PublishStorefrontPolicyRequest,
  type StorefrontTransitionRequest,
  type UpdateStorefrontRequest,
  type UpdateStorefrontSlugRequest,
} from '@drezivo/contracts';

import { requireStaffAuth } from '../../middleware/auth.js';
import { commandHandler, readHandler, staffContextOf, workspaceRateLimit } from '../../middleware/staff-command.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { validate } from '../../middleware/validate.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { storefrontCmsService as service } from './storefront-cms.service.js';

export const storefrontCmsRouter = Router();

const read = [requireStaffAuth, requireTenantContext, workspaceRateLimit(120), requireTenantAction('context_read')];
const write = [requireStaffAuth, requireTenantContext, workspaceRateLimit(30), requireTenantAction('publish')];

storefrontCmsRouter.get('/storefront', ...read, readHandler((req) => service.get(staffContextOf(req))));

storefrontCmsRouter.patch(
  '/storefront',
  ...write,
  validate({ body: updateStorefrontRequest }),
  commandHandler((req, key) => service.updateDocument(staffContextOf(req), key, req.body as UpdateStorefrontRequest)),
);

storefrontCmsRouter.post(
  '/storefront/slug',
  ...write,
  validate({ body: updateStorefrontSlugRequest }),
  commandHandler((req, key) => service.updateSlug(staffContextOf(req), key, req.body as UpdateStorefrontSlugRequest)),
);

storefrontCmsRouter.post(
  '/storefront/publish',
  ...write,
  validate({ body: storefrontTransitionRequest }),
  commandHandler((req, key) => service.publish(staffContextOf(req), key, (req.body as StorefrontTransitionRequest).version)),
);

storefrontCmsRouter.post(
  '/storefront/unpublish',
  ...write,
  validate({ body: storefrontTransitionRequest }),
  commandHandler((req, key) => service.unpublish(staffContextOf(req), key, (req.body as StorefrontTransitionRequest).version)),
);

storefrontCmsRouter.post(
  '/storefront/policies',
  ...write,
  validate({ body: publishStorefrontPolicyRequest }),
  commandHandler((req, key) => service.publishPolicy(staffContextOf(req), key, req.body as PublishStorefrontPolicyRequest)),
);
