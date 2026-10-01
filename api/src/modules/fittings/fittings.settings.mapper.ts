import { fittingSettings, type FittingSettings } from '@drezivo/contracts';

import type { FittingSettingsReadModel } from './fittings.settings.repository.js';

export function toFittingSettings(model: FittingSettingsReadModel): FittingSettings {
  return fittingSettings.parse({
    branch_id: model.branch_id,
    enabled: model.enabled,
    capacity: model.capacity,
    duration_minutes: model.duration_minutes,
    fee_minor: String(model.fee_minor),
    currency: model.currency,
    timezone: model.timezone,
    version: Number(model.version),
    updated_at: model.updated_at.toISOString(),
  });
}
