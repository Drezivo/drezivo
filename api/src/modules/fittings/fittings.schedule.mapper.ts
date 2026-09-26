import { fittingSettings, type FittingSettings, type FittingWeeklyHours } from '@drezivo/contracts';

import type { FittingSettingsReadModel } from './fittings.schedule.repository.js';

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export function toFittingSettings(model: FittingSettingsReadModel): FittingSettings {
  return fittingSettings.parse({
    branch_id: model.branch_id,
    enabled: model.enabled,
    capacity: model.capacity,
    duration_minutes: model.duration_minutes,
    fee_minor: String(model.fee_minor),
    currency: model.currency,
    timezone: model.timezone,
    weekly_hours: toWeeklyHours(model.hours),
    version: Number(model.version),
    updated_at: model.updated_at.toISOString(),
  });
}

export function toWeeklyHours(
  hours: Array<{ weekday: number; starts_local: string; ends_local: string }>,
): FittingWeeklyHours {
  return WEEKDAYS.map((weekday, index) => ({
    weekday,
    windows: hours
      .filter((row) => row.weekday === index + 1)
      .map((row) => ({ starts_local: row.starts_local, ends_local: row.ends_local })),
  }));
}
