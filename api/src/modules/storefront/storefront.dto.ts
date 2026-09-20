import { minorUnitsToDecimalString } from '../../shared/money.js';

/**
 * Explicit public-safe projections. These types intentionally do NOT mirror the database rows
 * — every field here is hand-picked because a public, unauthenticated caller may see it
 * (AGENTS.md: "Map database records to response DTOs before returning them" / "Services should
 * not return raw ... models to clients"). A field that is merely forgotten from a `select`
 * clause upstream still cannot leak through these mapper functions, because they only read the
 * named source fields they explicitly declare — this is the second, independent layer of
 * protection beyond storefront.repository.ts's own explicit `select`.
 *
 * Deliberately absent from every DTO below: internal ids for anything other than what the next
 * request needs (variant_id, to query availability), staff-only pricing internals, physical
 * asset codes/condition notes, branch operating internals, customer data, and payment method
 * destination secrets (only `rail`/`name` are public; `destination_snapshot` never leaves
 * finance/reservation confirmation flows).
 */

export interface StorefrontDTO {
  slug: string;
  branding: Record<string, unknown>;
  contact: Record<string, unknown>;
  policy: {
    version: number;
    rental_rules: Record<string, unknown>;
    deposit_rules: Record<string, unknown>;
    cancellation_rules: Record<string, unknown>;
    delivery_rules: Record<string, unknown>;
    privacy_notice: string;
  };
  payment_methods: PublicPaymentMethodDTO[];
  products: PublicProductDTO[];
}

export interface PublicPaymentMethodDTO {
  name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
}

export interface PublicProductDTO {
  id: string;
  name: string;
  description: string | null;
  image_urls: string[];
  variants: PublicVariantDTO[];
}

export interface PublicVariantDTO {
  id: string;
  size_label: string;
  color_label: string | null;
  /** Decimal string on the wire, minor-unit integer internally (TRD §4). */
  rental_price: string;
  security_deposit: string;
  currency: string;
  included_duration_minutes: number;
}

export interface AvailabilitySlotDTO {
  /** ISO instant. The window is a best-effort read, not a guarantee — TRD §5: "An availability response can lag; a hold cannot bypass the database constraint." */
  start: string;
  end: string;
  /** Count of ready, unallocated physical assets for this variant during the slot — never an asset id/code (that would leak inventory-tracking detail to the public). */
  available_units: number;
}

export interface StorefrontRowSource {
  slug: string;
  branding: Record<string, unknown>;
  contact: Record<string, unknown>;
}

export interface PolicyRowSource {
  version: number;
  rental_rules: Record<string, unknown>;
  deposit_rules: Record<string, unknown>;
  cancellation_rules: Record<string, unknown>;
  delivery_rules: Record<string, unknown>;
  privacy_notice: string;
}

export interface PaymentMethodRowSource {
  name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
}

export interface ProductRowSource {
  id: string;
  name: string;
  description: string | null;
  image_urls: string[];
  variants: VariantRowSource[];
}

export interface VariantRowSource {
  id: string;
  size_label: string;
  color_label: string | null;
  rental_price_minor: number;
  security_deposit_minor: number;
  currency: string;
  included_duration_minutes: number;
}

export function toStorefrontDTO(
  storefront: StorefrontRowSource,
  policy: PolicyRowSource,
  paymentMethods: PaymentMethodRowSource[],
  products: ProductRowSource[],
): StorefrontDTO {
  return {
    slug: storefront.slug,
    branding: storefront.branding,
    contact: storefront.contact,
    policy: {
      version: policy.version,
      rental_rules: policy.rental_rules,
      deposit_rules: policy.deposit_rules,
      cancellation_rules: policy.cancellation_rules,
      delivery_rules: policy.delivery_rules,
      privacy_notice: policy.privacy_notice,
    },
    payment_methods: paymentMethods.map((method) => ({ name: method.name, rail: method.rail })),
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      image_urls: product.image_urls,
      variants: product.variants.map(toVariantDTO),
    })),
  };
}

function toVariantDTO(variant: VariantRowSource): PublicVariantDTO {
  return {
    id: variant.id,
    size_label: variant.size_label,
    color_label: variant.color_label,
    rental_price: minorUnitsToDecimalString(variant.rental_price_minor),
    security_deposit: minorUnitsToDecimalString(variant.security_deposit_minor),
    currency: variant.currency,
    included_duration_minutes: variant.included_duration_minutes,
  };
}
