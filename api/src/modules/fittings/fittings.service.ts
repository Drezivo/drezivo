import {
  fittingDetail,
  fittingIntakeResponse,
  fittingListItem,
  fittingListResponse,
  type FittingAction,
  type FittingDetail,
  type FittingIntakeQuery,
  type FittingIntakeResponse,
  type FittingListItem,
  type FittingListQuery,
  type FittingListResponse,
  type FittingGarmentLineDetail,
  type FittingGarmentLineSummary,
  type FittingPaymentSummary,
  type FittingSettings,
  type PermissionCode,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import { ForbiddenError, NotFoundError, TenantCancelledError, TenantRestrictedError } from '../../shared/errors.js';
import {
  listFittingsReadModel,
  readFittingDetailModel,
  searchFittingIntakeCustomers,
  type FittingListReadRow,
} from './fittings.repository.js';
import { toFittingSettings } from './fittings.settings.mapper.js';
import { readFittingSettingsModel } from './fittings.settings.repository.js';

const FITTING_IMAGE_VIEW_EXPIRY_SECONDS = 10 * 60;

export interface FittingReadContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

export async function getFittingIntakeOptions(
  input: FittingReadContext,
  query: FittingIntakeQuery,
): Promise<FittingIntakeResponse> {
  assertFittingReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const customers = await searchFittingIntakeCustomers(client, {
      tenantId: input.tenantId,
      ...(query.customer_search ? { search: query.customer_search } : {}),
    });
    return fittingIntakeResponse.parse({ customers });
  });
}

export async function getFittingList(
  input: FittingReadContext,
  query: FittingListQuery,
  storage: ObjectStorage = objectStorage,
): Promise<FittingListResponse> {
  assertFittingReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const page = await listFittingsReadModel(client, { tenantId: input.tenantId, branchId: input.branchId, query });
    const imageAuthorizations = new Map<string, Promise<string>>();
    const items = await Promise.all(
      page.rows.map(async (row) =>
        toListItem(row, await mapGarmentsWithImages(row.garments, storage, imageAuthorizations)),
      ),
    );
    return fittingListResponse.parse({
      items,
      page_meta: { next_cursor: page.nextCursor, has_more: page.hasMore },
    });
  });
}

export async function getFittingDetail(input: FittingReadContext, fittingId: string): Promise<FittingDetail> {
  assertFittingReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const row = await readFittingDetailModel(client, { tenantId: input.tenantId, branchId: input.branchId, fittingId });
    if (!row) throw new NotFoundError('Fitting could not be found.');
    return fittingDetail.parse({
      ...toListItem(row),
      branch_id: row.branch_id,
      booking_channel: row.booking_channel,
      timezone_snapshot: row.timezone_snapshot,
      customer: {
        id: row.customer_id,
        full_name: row.customer_full_name,
        phone: row.customer_phone,
        email: row.customer_email,
        address: row.customer_address,
        social_media: row.customer_social_media,
      },
      garments: mapGarments(row.garments, true),
      internal_note: row.internal_note,
      terminal_reason: row.terminal_reason,
      allowed_actions: allowedActions(row.status, row.starts_at, row.ends_at),
    });
  });
}

export async function getFittingSettings(input: FittingReadContext): Promise<FittingSettings> {
  assertFittingReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const model = await readFittingSettingsModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
    });
    if (!model) throw new NotFoundError('Fitting settings could not be found.');
    return toFittingSettings(model);
  });
}

function toListItem(
  row: FittingListReadRow,
  garments: FittingGarmentLineSummary[] = mapGarments(row.garments, false),
): FittingListItem {
  return fittingListItem.parse({
    id: row.fitting_id,
    status: row.status,
    period: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString() },
    customer: { id: row.customer_id, full_name: row.customer_full_name },
    garments,
    fee: { fee_minor: String(row.fee_minor), currency: row.currency, payment: normalizePayment(row.payment) },
    attention: attention(row.status, row.starts_at, row.ends_at),
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
  });
}

type GarmentJson = {
  id: string;
  variant_id: string;
  product_name: string;
  sku: string;
  size_label: string | null;
  color_label: string | null;
  primary_image_storage_key: string | null;
  primary_image_version_id: string | null;
  garment_guaranteed: boolean;
  asset_id: string | null;
  asset_code: string | null;
};
async function mapGarmentsWithImages(
  value: unknown,
  storage: ObjectStorage,
  authorizations: Map<string, Promise<string>>,
): Promise<FittingGarmentLineSummary[]> {
  const rows = Array.isArray(value) ? (value as GarmentJson[]) : [];
  return Promise.all(
    rows.map(async (row) => {
      let primaryImageUrl: string | null = null;
      if (row.primary_image_storage_key) {
        const authorizationKey = `${row.primary_image_storage_key}\u0000${row.primary_image_version_id ?? ''}`;
        let authorization = authorizations.get(authorizationKey);
        if (!authorization) {
          authorization = storage
            .authorizeRead({
              storageKey: row.primary_image_storage_key,
              versionId: row.primary_image_version_id,
              expiresInSeconds: FITTING_IMAGE_VIEW_EXPIRY_SECONDS,
            })
            .then((result) => result.readUrl);
          authorizations.set(authorizationKey, authorization);
        }
        primaryImageUrl = await authorization;
      }

      return {
        id: row.id as FittingGarmentLineSummary['id'],
        variant: {
          variant_id: row.variant_id as FittingGarmentLineSummary['variant']['variant_id'],
          product_name: row.product_name,
          sku: row.sku,
          size_label: row.size_label,
          color_label: row.color_label,
          primary_image_url: primaryImageUrl,
        },
        garment_mode: row.garment_guaranteed ? 'guaranteed' : 'preference',
      };
    }),
  );
}

function mapGarments(value: unknown, includeAsset: true): FittingGarmentLineDetail[];
function mapGarments(value: unknown, includeAsset: false): FittingGarmentLineSummary[];
function mapGarments(
  value: unknown,
  includeAsset: boolean,
): Array<FittingGarmentLineDetail | FittingGarmentLineSummary> {
  const rows = Array.isArray(value) ? (value as GarmentJson[]) : [];
  return rows.map((row) => ({
    id: row.id as FittingGarmentLineSummary['id'],
    variant: {
      variant_id: row.variant_id as FittingGarmentLineSummary['variant']['variant_id'],
      product_name: row.product_name,
      sku: row.sku,
      size_label: row.size_label,
      color_label: row.color_label,
    },
    garment_mode: row.garment_guaranteed ? 'guaranteed' : 'preference',
    ...(includeAsset
      ? {
          assigned_asset: row.garment_guaranteed
            ? {
                id: row.asset_id as NonNullable<FittingGarmentLineDetail['assigned_asset']>['id'],
                asset_code: row.asset_code as string,
              }
            : null,
        }
      : {}),
  }));
}

function normalizePayment(value: unknown): FittingPaymentSummary | null {
  if (!value || typeof value !== 'object') return null;
  const payment = value as Record<string, unknown>;
  return {
    id: String(payment.id) as FittingPaymentSummary['id'],
    status: payment.status as FittingPaymentSummary['status'],
    evidence_status: payment.evidence_status as FittingPaymentSummary['evidence_status'],
    amount_minor: String(payment.amount_minor),
    currency: String(payment.currency),
    verified_at:
      payment.verified_at instanceof Date
        ? payment.verified_at.toISOString()
        : typeof payment.verified_at === 'string'
          ? payment.verified_at
          : null,
  };
}

function attention(status: FittingListReadRow['status'], startsAt: Date, endsAt: Date): 'none' | 'outcome_required' {
  if ((status === 'pending' || status === 'confirmed') && Date.now() >= endsAt.getTime()) return 'outcome_required';
  return 'none';
}

function allowedActions(status: FittingListReadRow['status'], startsAt: Date, endsAt: Date): FittingAction[] {
  const now = Date.now();
  if (status === 'pending') {
    const actions: FittingAction[] = ['update_note', 'confirm'];
    if (now < startsAt.getTime()) actions.push('reject', 'cancel', 'reschedule', 'update_garments');
    return actions;
  }
  if (status === 'confirmed') {
    const actions: FittingAction[] = ['update_note'];
    if (now < startsAt.getTime()) actions.push('cancel', 'reschedule', 'update_garments');
    if (now >= endsAt.getTime()) actions.push('complete');
    if (now >= startsAt.getTime()) actions.push('mark_no_show');
    return actions;
  }
  return [];
}

function assertFittingReadContext(input: FittingReadContext): void {
  if (input.effectiveTenantStatus === 'cancelled') throw new TenantCancelledError('This workspace is closed.');
  if (input.effectiveTenantStatus === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
  // V1.1 deliberately reuses the existing branch operational grant; BE-7 may add an additive fitting-specific code.
  if (!input.permissionCodes.includes('reservations.manage')) throw new ForbiddenError('This branch does not grant fitting access.');
}
