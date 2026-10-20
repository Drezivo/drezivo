import {
  clothingAvailabilityTimelineQuery,
  clothingAvailabilityTimelineResponse,
  dashboardFittingSummaryResponse,
  OPERATIONAL_CALENDAR_MAX_EVENTS,
  operationalCalendarQuery,
  operationalCalendarResponse,
  type ClothingAvailabilityTimelineAgenda,
  type ClothingAvailabilityTimelineQuery,
  type ClothingAvailabilityTimelineResponse,
  type DashboardFittingSummaryResponse,
  type OperationalCalendarQuery,
  type OperationalCalendarResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import { staffFileMediaUrl } from '../files/file-media-url.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  listClothingAvailabilityTimelineAssets,
  readOperationalCalendarCategories,
  readDashboardFittingSummary,
  readClothingAvailabilityTimelineAgendas,
  readClothingAvailabilityTimelineFacets,
  readClothingAvailabilityTimelineWindow,
  readOperationalCalendarEvents,
} from './operations.repository.js';


export interface OperationsReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
}

export async function getOperationalCalendar(
  context: OperationsReadContext,
  queryInput: OperationalCalendarQuery,
): Promise<OperationalCalendarResponse> {
  const parsed = operationalCalendarQuery.safeParse(queryInput);
  if (!parsed.success) throw new ValidationError('Calendar query is invalid.');
  assertOperationsReadPermission(context);
  const query = parsed.data;

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const page = await readOperationalCalendarEvents(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      start: query.start,
      end: query.end,
    });
    const categories = await readOperationalCalendarCategories(client, context.tenantId);
    return operationalCalendarResponse.parse({
      window: { start: query.start, end: query.end },
      categories,
      events: page.rows.slice(0, OPERATIONAL_CALENDAR_MAX_EVENTS).map((row) => ({
        id: row.id,
        source: row.source,
        source_id: row.source_id,
        event_type: row.event_type,
        branch_id: row.branch_id,
        period: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString() },
        customer_name: row.customer_name,
        item_names: row.item_names,
        category_ids: row.category_ids,
        status: row.status,
        ...(row.source === 'reservation' ? { time_unspecified: row.time_unspecified } : {}),
      })),
      truncated: page.truncated,
    });
  });
}

export async function getClothingAvailabilityTimeline(
  context: OperationsReadContext,
  queryInput: ClothingAvailabilityTimelineQuery,
  _storage: ObjectStorage = objectStorage,
): Promise<ClothingAvailabilityTimelineResponse> {
  void _storage;
  const parsed = clothingAvailabilityTimelineQuery.safeParse(queryInput);
  if (!parsed.success) throw new ValidationError('Clothing availability query is invalid.');
  assertOperationsReadPermission(context);
  const query = parsed.data;

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const window = await readClothingAvailabilityTimelineWindow(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      startDate: query.start_date,
      endDate: query.end_date,
    });
    if (!window) throw new NotFoundError('Active branch could not be found.');

    const page = await listClothingAvailabilityTimelineAssets(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      window,
      query,
    });
    // A PoolClient owns one PostgreSQL connection, so its queries must remain serial. The
    // candidate page is already bounded; these two read projections are therefore fixed work.
    const agendaRows = await readClothingAvailabilityTimelineAgendas(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      assetIds: page.rows.map((row) => row.asset_id),
      window,
      status: query.status,
    });
    const facets = await readClothingAvailabilityTimelineFacets(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
    });
    const agendasByAssetId = groupAgendasByAsset(agendaRows, window.timezone);
    const rows = page.rows.map((row) => {
        const primaryImageUrl = row.primary_image_file_id ? staffFileMediaUrl(row.primary_image_file_id, context.branchId) : null;
        return {
          product: {
            id: row.product_id,
            name: row.product_name,
            primary_image_url: primaryImageUrl,
          },
          variant: {
            id: row.variant_id,
            size_label: row.size_label,
            color_label: row.color_label,
            rental_price_minor: row.rental_price_minor.toString(),
            currency: row.currency,
          },
          asset: { id: row.asset_id, readiness: row.readiness },
          agendas: agendasByAssetId.get(row.asset_id) ?? [],
        };
      });

    return clothingAvailabilityTimelineResponse.parse({
      timezone: window.timezone,
      window: {
        start_date: query.start_date,
        end_date: query.end_date,
      },
      facets,
      rows,
      page_meta: {
        next_cursor: page.nextCursor,
        has_more: page.hasMore,
      },
    });
  });
}

export async function getDashboardFittingSummary(
  context: OperationsReadContext,
): Promise<DashboardFittingSummaryResponse> {
  assertOperationsReadPermission(context);
  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const row = await readDashboardFittingSummary(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
    });
    if (!row) throw new NotFoundError('Active branch could not be found.');
    return dashboardFittingSummaryResponse.parse({
      window: {
        today_start: row.today_start.toISOString(),
        today_end: row.today_end.toISOString(),
        upcoming_end: row.upcoming_end.toISOString(),
      },
      fittings_today: row.fittings_today,
      fittings_upcoming: row.fittings_upcoming,
      fittings_pending_review: row.fittings_pending_review,
    });
  });
}

function assertOperationsReadPermission(context: OperationsReadContext): void {
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant operational schedule access.');
  }
}

function groupAgendasByAsset(
  rows: Awaited<ReturnType<typeof readClothingAvailabilityTimelineAgendas>>,
  timezone: string,
): Map<string, ClothingAvailabilityTimelineAgenda[]> {
  const agendasByAsset = new Map<string, ClothingAvailabilityTimelineAgenda[]>();
  for (const row of rows) {
    const agendas = agendasByAsset.get(row.asset_id) ?? [];
    agendas.push({
      id: row.id,
      type: row.type,
      period: {
        start: row.starts_at.toISOString(),
        end: row.ends_at.toISOString(),
      },
      display_lane: 0,
      source_type: row.source_type,
      source_id: row.source_id,
      customer_name: row.customer_name,
      pickup: row.pickup_at
        ? { date: toBranchDate(row.pickup_at, timezone), at: row.pickup_at.toISOString() }
        : null,
      return: row.return_at
        ? { date: toBranchDate(row.return_at, timezone), at: row.return_at.toISOString() }
        : null,
      unavailable_reason: row.unavailable_reason,
    });
    agendasByAsset.set(row.asset_id, agendas);
  }
  for (const [assetId, agendas] of agendasByAsset) {
    agendasByAsset.set(assetId, assignDisplayLanes(agendas));
  }
  return agendasByAsset;
}

function assignDisplayLanes(
  agendas: ClothingAvailabilityTimelineAgenda[],
): ClothingAvailabilityTimelineAgenda[] {
  const ordered = [...agendas].sort((left, right) => {
    const startDifference = Date.parse(left.period.start) - Date.parse(right.period.start);
    if (startDifference !== 0) return startDifference;
    const endDifference = Date.parse(left.period.end) - Date.parse(right.period.end);
    if (endDifference !== 0) return endDifference;
    return left.id.localeCompare(right.id);
  });
  const laneEnds: number[] = [];
  return ordered.map((agenda) => {
    const start = Date.parse(agenda.period.start);
    const lane = laneEnds.findIndex((end) => end <= start);
    const displayLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[displayLane] = Date.parse(agenda.period.end);
    if (displayLane > 99) {
      throw new ValidationError('Too many overlapping availability agendas for one asset.');
    }
    return { ...agenda, display_lane: displayLane };
  });
}

function toBranchDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get('year');
  const month = byType.get('month');
  const day = byType.get('day');
  if (!year || !month || !day) throw new ValidationError('Branch timezone could not format a calendar date.');
  return `${year}-${month}-${day}`;
}
