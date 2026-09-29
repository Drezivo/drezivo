import { Router } from 'express';

import {
  updateBusinessSettingsRequest,
  updateNotificationSettingsRequest,
  type UpdateBusinessSettingsRequest,
  type UpdateNotificationSettingsRequest,
} from '@drezivo/contracts';

import { requireStaffAuth } from '../../middleware/auth.js';
import { commandHandler, readHandler, staffContextOf, workspaceRateLimit } from '../../middleware/staff-command.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { validate } from '../../middleware/validate.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { settingsService as service } from './settings.service.js';

export const settingsRouter = Router();

const read = [requireStaffAuth, requireTenantContext, workspaceRateLimit(120), requireTenantAction('context_read')];
const write = [requireStaffAuth, requireTenantContext, workspaceRateLimit(30), requireTenantAction('publish')];

settingsRouter.get('/settings/business', ...read, readHandler((req) => service.getBusiness(staffContextOf(req))));
settingsRouter.patch(
  '/settings/business',
  ...write,
  validate({ body: updateBusinessSettingsRequest }),
  commandHandler((req, key) => service.updateBusiness(staffContextOf(req), key, req.body as UpdateBusinessSettingsRequest)),
);

settingsRouter.get('/settings/notifications', ...read, readHandler((req) => service.getNotifications(staffContextOf(req))));
settingsRouter.patch(
  '/settings/notifications',
  ...write,
  validate({ body: updateNotificationSettingsRequest }),
  commandHandler((req, key) =>
    service.updateNotifications(staffContextOf(req), key, req.body as UpdateNotificationSettingsRequest),
  ),
);
