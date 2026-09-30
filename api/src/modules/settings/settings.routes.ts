import { Router } from 'express';

import {
  branchClosureCreateRequest,
  branchClosureListQuery,
  branchClosureParams,
  branchClosureRemoveRequest,
  branchClosureUpdateRequest,
  updateBranchBusinessHoursRequest,
  updateBusinessSettingsRequest,
  updateNotificationSettingsRequest,
  type BranchClosureCreateRequest,
  type BranchClosureListQuery,
  type BranchClosureRemoveRequest,
  type BranchClosureUpdateRequest,
  type UpdateBranchBusinessHoursRequest,
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

settingsRouter.get(
  '/settings/business-hours',
  ...read,
  readHandler((req) => service.getBusinessHours(staffContextOf(req))),
);
settingsRouter.patch(
  '/settings/business-hours',
  ...write,
  validate({ body: updateBranchBusinessHoursRequest }),
  commandHandler((req, key) =>
    service.updateBusinessHours(
      staffContextOf(req),
      key,
      req.body as UpdateBranchBusinessHoursRequest,
    ),
  ),
);
settingsRouter.get(
  '/settings/business-hours/closures',
  ...read,
  validate({ query: branchClosureListQuery }),
  readHandler((req) =>
    service.listBranchClosures(staffContextOf(req), req.query as unknown as BranchClosureListQuery),
  ),
);
settingsRouter.post(
  '/settings/business-hours/closures',
  ...write,
  validate({ body: branchClosureCreateRequest }),
  commandHandler((req, key) =>
    service.createBranchClosure(
      staffContextOf(req),
      key,
      req.body as BranchClosureCreateRequest,
    ),
  ),
);
settingsRouter.patch(
  '/settings/business-hours/closures/:closureId',
  ...write,
  validate({ params: branchClosureParams, body: branchClosureUpdateRequest }),
  commandHandler((req, key) =>
    service.updateBranchClosure(
      staffContextOf(req),
      String(req.params.closureId ?? ''),
      key,
      req.body as BranchClosureUpdateRequest,
    ),
  ),
);
settingsRouter.post(
  '/settings/business-hours/closures/:closureId/remove',
  ...write,
  validate({ params: branchClosureParams, body: branchClosureRemoveRequest }),
  commandHandler((req, key) =>
    service.removeBranchClosure(
      staffContextOf(req),
      String(req.params.closureId ?? ''),
      key,
      req.body as BranchClosureRemoveRequest,
    ),
  ),
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
