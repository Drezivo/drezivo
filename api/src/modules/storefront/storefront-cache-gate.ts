import type { PoolClient } from 'pg';
import { branchOperatingHours, publicPaymentMethod, type PublicStorefront } from '@drezivo/contracts';

import { NotFoundError, StateConflictError } from '../../shared/errors.js';
import { resolveTenantEntitlements } from '../entitlements/entitlements.service.js';
import { toDocument } from '../storefront-cms/storefront-cms.service.js';
import { fromPolicyColumns } from './storefront-policy.js';
import { readEffectivePolicy, readFittingConfig, readStoreCore, readStorefrontPaymentMethods, withPublishedStore, type PublishedStore } from './storefront.repository.js';

export interface PublicCacheReferences {
  products: string[];
  images: Array<{ product_id: string; file_id: string }>;
  variants: Array<{ product_id: string; variant_id: string; guide_file_id: string | null }>;
  store_images: Array<{ slot: 'logo' | 'cover' | 'hero' | 'about' | 'policy'; file_id: string }>;
  scope: 'store' | 'catalogue' | 'item';
}

type StoreLiveState = Pick<PublicStorefront, 'booking_open' | 'reservations_open' | 'currency' | 'timezone' | 'payment_methods' | 'checkout' | 'fulfillment' | 'fitting'> & {
  fitting_section: boolean;
  policy: Omit<PublicStorefront['policy'], 'image_urls'>;
};

/** Verify all references together; an invalid reference forces the Worker to fetch fresh content. */
export async function checkPublicCacheReferences(slug: string, references: PublicCacheReferences): Promise<{ tenant_id: string; valid: boolean; live?: StoreLiveState }> {
  const result = await withPublishedStore(slug, async (client, store) => {
    const valid = await referencesRemainPublic(client, store.tenantId, references);
    if (!valid || references.scope !== 'store') return { tenant_id: store.tenantId, valid };
    const { live, imagesValid } = await readStoreLiveState(client, store, references.store_images);
    return { tenant_id: store.tenantId, valid: imagesValid, live };
  });
  if (!result) throw new NotFoundError('This store is not available.');
  return result;
}

async function readStoreLiveState(client: PoolClient, store: PublishedStore, images: PublicCacheReferences['store_images']): Promise<{ live: StoreLiveState; imagesValid: boolean }> {
  const core = await readStoreCore(client, store);
  if (!core) throw new NotFoundError('This store is not available.');
  const document = toDocument(core);
  const hours = branchOperatingHours.safeParse(core.operating_hours);
  if (!hours.success) throw new StateConflictError('This shop needs valid Business Hours before taking online reservations.');
  const entitlements = await resolveTenantEntitlements(client, store.tenantId);
  const policy = await readEffectivePolicy(client, store);
  const rules = policy ? fromPolicyColumns(policy) : null;
  const reservations = entitlements.features.storefront_reservations;
  const paymentMethods = reservations ? await readStorefrontPaymentMethods(client, store.tenantId) : [];
  const fitting = await readFittingConfig(client, store);
  const fittingOpen = entitlements.features.fittings && fitting !== null && fitting.enabled && document.checkout.fitting_requests;
  const fileIds = [...new Set(images.map((image) => image.file_id))];
  const files = fileIds.length ? await client.query<{ id: string }>(
    `SELECT id FROM file_object WHERE tenant_id = $1 AND id = ANY($2::uuid[])
      AND lifecycle_status = 'accepted' AND frozen_at IS NOT NULL AND purpose = 'storefront_asset'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')`,
    [store.tenantId, fileIds],
  ) : { rows: [] };
  const accepted = new Set(files.rows.map((row) => row.id));
  const slots = {
    logo: document.branding.logo_file_id,
    cover: document.branding.cover_file_id,
    hero: document.content.hero.image_file_id,
    about: document.content.about.image_file_id,
  };
  const imagesValid = images.every(({ slot, file_id }) => accepted.has(file_id) &&
    (slot === 'policy' ? rules?.format === 'images' && rules.image_file_ids.some((id) => id === file_id) : slots[slot] === file_id));
  const imageTerms = rules?.format === 'images';
  const live = {
    booking_open: store.bookingOpen,
    reservations_open: store.bookingOpen && reservations && document.checkout.reservation_requests,
    currency: core.currency,
    timezone: core.timezone,
    payment_methods: paymentMethods.map((method) => publicPaymentMethod.parse(method)),
    fulfillment: { pickup: true as const, delivery: reservations && (rules?.delivery.enabled ?? false), delivery_fee_minor: '0' },
    checkout: {
      requirements: reservations ? document.checkout.requirements : { phone: 'hidden' as const, social_handle: 'hidden' as const, event_date: 'hidden' as const },
      handover_time: document.checkout.handover_time,
      min_notice_days: document.checkout.min_notice_days,
      max_rental_days: document.checkout.max_rental_days,
      business_hours: hours.data,
    },
    fitting: {
      enabled: fittingOpen,
      duration_minutes: fittingOpen ? fitting.duration_minutes : null,
      fee_minor: fittingOpen && fitting.fee_minor !== '0' ? fitting.fee_minor : null,
    },
    fitting_section: document.content.sections.fitting && fittingOpen,
    policy: {
      version: policy?.version ?? 1,
      format: imageTerms ? 'images' as const : 'text' as const,
      rental: imageTerms ? '' : rules?.rental ?? '',
      deposit: imageTerms ? '' : rules?.deposit ?? '',
      cancellation: imageTerms ? '' : rules?.cancellation ?? '',
      damage: imageTerms ? null : rules?.damage ?? null,
      delivery_notes: reservations ? rules?.delivery.notes ?? null : null,
      privacy_notice: rules?.privacy_notice ?? '',
    },
  };
  return { live, imagesValid };
}

async function referencesRemainPublic(client: PoolClient, tenantId: string, refs: PublicCacheReferences): Promise<boolean> {
  const result = await client.query<{ valid: boolean }>(
    `SELECT
       NOT EXISTS (
         SELECT 1 FROM unnest($2::uuid[]) requested(id)
          WHERE NOT EXISTS (
            SELECT 1 FROM product p
              LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
             WHERE p.tenant_id = $1 AND p.id = requested.id AND p.status = 'active'
               AND (p.category_id IS NULL OR c.status = 'active')
               AND EXISTS (SELECT 1 FROM product_variant pv WHERE pv.tenant_id = p.tenant_id AND pv.product_id = p.id AND pv.status = 'active')
          )
       ) AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS requested(product_id uuid, file_id uuid)
          WHERE NOT EXISTS (
            SELECT 1 FROM product_image pi
              JOIN file_object f ON f.tenant_id = pi.tenant_id AND f.id = pi.file_id
             WHERE pi.tenant_id = $1 AND pi.product_id = requested.product_id AND pi.file_id = requested.file_id
               AND f.lifecycle_status = 'accepted' AND f.frozen_at IS NOT NULL AND f.purpose = 'catalogue_image'
               AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          )
       ) AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS requested(product_id uuid, variant_id uuid, guide_file_id uuid)
          WHERE NOT EXISTS (
            SELECT 1 FROM product_variant pv
              LEFT JOIN measurement_guide mg ON mg.tenant_id = pv.tenant_id AND mg.id = pv.measurement_guide_id
              LEFT JOIN file_object f ON f.tenant_id = mg.tenant_id AND f.id = mg.file_id
             WHERE pv.tenant_id = $1 AND pv.product_id = requested.product_id AND pv.id = requested.variant_id AND pv.status = 'active'
               AND (requested.guide_file_id IS NULL OR (pv.measurement_mode = 'default_guide' AND mg.status = 'active'
                 AND mg.file_id = requested.guide_file_id AND f.lifecycle_status = 'accepted' AND f.frozen_at IS NOT NULL
                 AND f.purpose = 'measurement_guide' AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')))
          )
       ) AS valid`,
    [tenantId, refs.products, JSON.stringify(refs.images), JSON.stringify(refs.variants)],
  );
  return result.rows[0]?.valid === true;
}
