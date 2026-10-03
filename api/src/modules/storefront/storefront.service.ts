import type { PoolClient } from 'pg';
import type { z } from 'zod';

import {
  catalogueCard,
  catalogueResponse,
  fittingSlotsResponse,
  itemDetail,
  publicAvailabilityResponse,
  publicStorefront,
  type CatalogueQuery,
  type CatalogueResponse,
  type FittingSlotsResponse,
  type ItemDetail,
  type PublicAvailabilityDay,
  type PublicAvailabilityQuery,
  type PublicAvailabilityResponse,
  type PublicMeasurement,
  type PublicStorefront,
  type StorefrontDocument,
} from '@drezivo/contracts';

import { NotFoundError } from '../../shared/errors.js';
import { toDocument } from '../storefront-cms/storefront-cms.service.js';
import { closedReason, readShopClosures } from './shop-closures.js';
import { storefrontMediaSigner, type StorefrontMediaSigner } from './storefront-media.js';
import { fromPolicyColumns } from './storefront-policy.js';
import {
  computeAvailability,
  isVisibleVariant,
  readCatalogueCards,
  readEffectivePolicy,
  readFittingConfig,
  readOpenFittingSlots,
  readPublicCategories,
  readPublicItem,
  readPublicSizes,
  readPublicSubcategories,
  readStoreCore,
  readStorefrontPaymentMethods,
  withPublishedStore,
  type CatalogueCardRow,
  type CatalogueFilter,
  type ItemVariantRow,
  type PublishedStore,
  type StoreCoreRow,
} from './storefront.repository.js';
import type { PreviewGrant } from './storefront-preview.js';

const NOT_FOUND = 'This store is not available.';
const DAY_MS = 86_400_000;

/**
 * The published storefront, its catalogue, item pages, date availability, and fitting slots.
 * Unknown slugs, drafts, hidden products, and foreign sizes are all the same 404.
 */
export class PublicStorefrontService {
  constructor(private readonly media: StorefrontMediaSigner = storefrontMediaSigner) {}

  async getStorefront(slug: string, preview: PreviewGrant | null = null): Promise<PublicStorefront> {
    const result = await withPublishedStore(slug, async (client, store) => {
      const core = await this.requireCore(client, store);
      const document = toDocument(core);
      // One pooled connection runs queries one at a time, so these are sequential on purpose.
      const policy = await readEffectivePolicy(client, store);
      const paymentMethods = await readStorefrontPaymentMethods(client, store.tenantId);
      const fitting = await readFittingConfig(client, store);
      const categories = await readPublicCategories(client, store.tenantId);
      const featuredRows = document.content.featured_product_ids.length > 0
        ? await readCatalogueCards(client, store.tenantId, { productIds: document.content.featured_product_ids, sort: 'featured', limit: 12, offset: 0 })
        : [];
      const newRows = await readCatalogueCards(client, store.tenantId, { sort: 'newest', limit: 8, offset: 0 });

      const rules = policy ? fromPolicyColumns(policy) : null;
      // Image terms replace the typed terms entirely; text kept in the editor for later is not published.
      const imageTerms = rules?.format === 'images';
      const typedTerms = imageTerms ? null : rules;
      const featuredOrder = new Map<string, number>(document.content.featured_product_ids.map((id, index) => [id, index]));
      const featured = [...featuredRows].sort((a, b) => (featuredOrder.get(a.product_id) ?? 0) - (featuredOrder.get(b.product_id) ?? 0));

      const urls = await this.media.sign(client, store.tenantId, [
        document.branding.logo_file_id,
        document.branding.cover_file_id,
        document.content.hero.image_file_id,
        document.content.about.image_file_id,
        ...featured.map((row) => row.image_file_id),
        ...newRows.map((row) => row.image_file_id),
        ...(imageTerms ? rules.image_file_ids : []),
      ]);
      const urlOf = (id: string | null): string | null => (id ? (urls.get(id) ?? null) : null);
      const policyImageUrls = imageTerms ? rules.image_file_ids.flatMap((id) => urlOf(id) ?? []) : [];
      const fittingOpen = fitting !== null && fitting.enabled && document.checkout.fitting_requests;

      return publicStorefront.parse({
        slug: core.slug,
        name: document.branding.display_name,
        tagline: document.branding.tagline,
        description: document.branding.description,
        theme: document.branding.theme,
        logo_url: urlOf(document.branding.logo_file_id),
        cover_url: urlOf(document.branding.cover_file_id),
        currency: core.currency,
        timezone: core.timezone,
        contact: publicContact(document),
        content: {
          announcement: document.content.announcement,
          hero: { heading: document.content.hero.heading, body: document.content.hero.body, image_url: urlOf(document.content.hero.image_file_id) },
          about: { heading: document.content.about.heading, body: document.content.about.body, image_url: urlOf(document.content.about.image_file_id) },
          sections: { ...document.content.sections, fitting: document.content.sections.fitting && fittingOpen },
        },
        categories,
        featured: featured.map((row) => toCard(row, urlOf)),
        new_arrivals: newRows.map((row) => toCard(row, urlOf)),
        policy: {
          version: policy?.version ?? 1,
          format: imageTerms ? 'images' : 'text',
          image_urls: policyImageUrls,
          rental: typedTerms?.rental ?? '',
          deposit: typedTerms?.deposit ?? '',
          cancellation: typedTerms?.cancellation ?? '',
          damage: typedTerms?.damage ?? null,
          delivery_notes: rules?.delivery.notes ?? null,
          privacy_notice: rules?.privacy_notice ?? '',
        },
        fulfillment: {
          pickup: true,
          delivery: rules?.delivery.enabled ?? false,
          delivery_fee_minor: rules?.delivery.enabled ? rules.delivery.fee_minor : '0',
        },
        payment_methods: paymentMethods,
        booking_open: store.bookingOpen,
        checkout: {
          requirements: document.checkout.requirements,
          handover_time: document.checkout.handover_time,
          min_notice_days: document.checkout.min_notice_days,
          max_rental_days: document.checkout.max_rental_days,
        },
        fitting: {
          enabled: fittingOpen,
          duration_minutes: fittingOpen ? fitting.duration_minutes : null,
          fee_minor: fittingOpen && fitting.fee_minor !== '0' ? fitting.fee_minor : null,
        },
      });
    }, preview);
    if (!result) throw new NotFoundError(NOT_FOUND);
    return result;
  }

  async getCatalogue(slug: string, query: CatalogueQuery, preview: PreviewGrant | null = null): Promise<CatalogueResponse> {
    const result = await withPublishedStore(slug, async (client, store) => {
      const filter: CatalogueFilter = {
        sort: query.sort,
        limit: query.page_size,
        offset: (query.page - 1) * query.page_size,
        ...(query.search ? { search: query.search } : {}),
        ...(query.category ? { categoryId: query.category } : {}),
        ...(query.subcategory ? { subcategory: query.subcategory } : {}),
        ...(query.size ? { size: query.size } : {}),
      };
      const rows = await readCatalogueCards(client, store.tenantId, filter);
      const sizes = await readPublicSizes(client, store.tenantId);
      const subcategories = await readPublicSubcategories(client, store.tenantId);
      const urls = await this.media.sign(client, store.tenantId, rows.map((row) => row.image_file_id));
      return catalogueResponse.parse({
        items: rows.map((row) => toCard(row, (id) => (id ? (urls.get(id) ?? null) : null))),
        total: Number(rows[0]?.total ?? 0),
        page: query.page,
        page_size: query.page_size,
        sizes,
        subcategories,
      });
    }, preview);
    if (!result) throw new NotFoundError(NOT_FOUND);
    return result;
  }

  async getItem(slug: string, productId: string, preview: PreviewGrant | null = null): Promise<ItemDetail> {
    const result = await withPublishedStore(slug, async (client, store) => {
      const found = await readPublicItem(client, store.tenantId, productId);
      if (!found || found.variants.length === 0) return null;
      const urls = await this.media.sign(client, store.tenantId, [
        ...found.item.image_file_ids,
        ...found.variants.map((variant) => variant.guide_file_id),
      ]);
      return itemDetail.parse({
        product_id: found.item.product_id,
        name: found.item.name,
        description: found.item.description,
        category: found.item.category,
        subcategory: found.item.subcategory,
        image_urls: found.item.image_file_ids.flatMap((id) => {
          const url = urls.get(id);
          return url ? [url] : [];
        }),
        variants: found.variants.map((variant) => ({
          variant_id: variant.variant_id,
          size_label: variant.size_label,
          color_label: variant.color_label,
          rental_price_minor: variant.rental_price_minor,
          security_deposit_minor: variant.security_deposit_minor,
          pricing_mode: variant.pricing_mode,
          included_duration_minutes: variant.included_duration_minutes,
          extra_day_price_minor: variant.extra_day_price_minor,
          measurement: toMeasurement(variant, variant.guide_file_id ? (urls.get(variant.guide_file_id) ?? null) : null),
        })),
      });
    }, preview);
    if (!result) throw new NotFoundError(NOT_FOUND);
    return result;
  }

  /**
   * Day states for one size. Days inside the owner's minimum notice are unavailable. Internal
   * reasons (cleaning, maintenance, transfer) are never shown; they collapse to "unavailable".
   */
  async getAvailability(slug: string, query: PublicAvailabilityQuery, preview: PreviewGrant | null = null): Promise<PublicAvailabilityResponse> {
    const store = await withPublishedStore(slug, async (client, found) => {
      if (!(await isVisibleVariant(client, found.tenantId, query.variant_id))) return null;
      const core = await this.requireCore(client, found);
      const today = localDate(new Date(), core.timezone);
      return {
        timezone: core.timezone,
        earliest: addDays(today, toDocument(core).checkout.min_notice_days),
        closures: await readShopClosures(client, found, query.from, query.to),
      };
    }, preview);
    if (!store) throw new NotFoundError(NOT_FOUND);

    const days = enumerateDays(query.from, query.to);
    const rows = await computeAvailability(
      slug,
      query.variant_id,
      zonedMidnight(query.from, store.timezone),
      zonedMidnight(addDays(query.to, 1), store.timezone),
      preview,
    );
    if (!rows) throw new NotFoundError(NOT_FOUND);

    return publicAvailabilityResponse.parse({
      variant_id: query.variant_id,
      days: days.map((date, index): PublicAvailabilityDay => {
        const row = rows[index];
        // Closed days keep the garment's own state: they only rule out pickup and return, not a
        // rental that runs across them.
        const closed = closedReason(store.closures, date) ? { closed: true } : {};
        if (date < store.earliest || !row) return { date, state: 'unavailable', ...closed };
        if (row.available_units > 0) return { date, state: 'available', ...closed };
        if (row.blocking_reasons.includes('reservation')) return { date, state: 'reserved', ...closed };
        if (row.blocking_reasons.includes('fitting')) return { date, state: 'fitting', ...closed };
        return { date, state: 'unavailable', ...closed };
      }),
    });
  }

  async getFittingSlots(slug: string, date: string, preview: PreviewGrant | null = null): Promise<FittingSlotsResponse> {
    const result = await withPublishedStore(slug, async (client, store) => {
      const core = await this.requireCore(client, store);
      const fitting = await readFittingConfig(client, store);
      if (!fitting?.enabled || !toDocument(core).checkout.fitting_requests) return null;
      const slots = await readOpenFittingSlots(client, store, date);
      return fittingSlotsResponse.parse({
        date,
        duration_minutes: fitting.duration_minutes,
        fee_minor: fitting.fee_minor === '0' ? null : fitting.fee_minor,
        slots: slots.map((slot) => ({ start_at: slot.start_at.toISOString(), end_at: slot.end_at.toISOString() })),
      });
    }, preview);
    if (!result) throw new NotFoundError(NOT_FOUND);
    return result;
  }

  private async requireCore(client: PoolClient, store: PublishedStore): Promise<StoreCoreRow> {
    const core = await readStoreCore(client, store);
    if (!core) throw new NotFoundError(NOT_FOUND);
    return core;
  }
}

function toCard(row: CatalogueCardRow, urlOf: (id: string | null) => string | null): z.input<typeof catalogueCard> {
  return {
    product_id: row.product_id,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    image_url: urlOf(row.image_file_id),
    price_from_minor: row.price_from_minor,
    pricing_mode: row.pricing_mode,
    included_duration_minutes: row.included_duration_minutes,
    sizes: row.sizes.slice(0, 30),
  };
}

function publicContact(document: StorefrontDocument): PublicStorefront['contact'] {
  const { contact } = document;
  return {
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    instagram_url: contact.instagram ? `https://www.instagram.com/${contact.instagram}/` : null,
    facebook_url: contact.facebook ? `https://www.facebook.com/${contact.facebook}` : null,
    tiktok_url: contact.tiktok ? `https://www.tiktok.com/@${contact.tiktok}` : null,
  };
}

function toMeasurement(variant: ItemVariantRow, guideUrl: string | null): PublicMeasurement {
  if (variant.measurement_mode === 'default_guide') return { mode: 'default_guide', guide_image_url: guideUrl };
  if (variant.measurement_mode !== 'custom') return { mode: 'none' };
  const values = Object.entries(variant.measurements)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .slice(0, 20)
    .map(([key, value]) => ({
      label: key.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase()),
      value: `${value} ${variant.measurement_unit}`,
    }));
  return values.length > 0 ? { mode: 'custom', unit: variant.measurement_unit, values } : { mode: 'none' };
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Local midnight of a date as an ISO instant with the zone's UTC offset (V1 zones have no DST). */
export function zonedMidnight(date: string, timeZone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = name && name !== 'GMT' ? name.replace('GMT', '') : '+00:00';
  return `${date}T00:00:00${offset}`;
}

export const publicStorefrontService = new PublicStorefrontService();
