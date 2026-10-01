/**
 * Storefront CMS — the owner-edited content behind `/s/<slug>`.
 *
 * Everything the owner can type is plain, bounded text. Markup is never stored or rendered, and
 * social profiles are stored as handles so the public URL is always built by the server from a
 * fixed host (a pasted `javascript:` link cannot exist). Images are referenced by accepted
 * `storefront_asset` file ids from the same workspace, never by arbitrary URLs.
 */
import { z } from 'zod';

import { fileObjectId, productId } from '../common/ids';
import { nonNegativeMoneyString } from '../common/money';
import { isoInstant } from '../common/time';

const LINE_BREAK = /[\r\n]/;

/** Tab, line feed, and carriage return are the only control characters allowed. */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
  }
  return false;
}

/** Trimmed, bounded plain text. Single-line unless `multiline` is set. */
export function plainText(max: number, options: { min?: number; multiline?: boolean } = {}) {
  return z
    .string()
    .trim()
    .min(options.min ?? 0)
    .max(max)
    .refine((value) => !hasControlCharacter(value), 'must not contain control characters')
    .refine((value) => options.multiline === true || !LINE_BREAK.test(value), 'must be a single line');
}

const optionalText = (max: number, multiline = false) => plainText(max, { multiline }).nullable();

export const socialHandle = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'use letters, numbers, dots, or underscores'));

export const facebookPage = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.-]{1,80}$/, 'use the page name from facebook.com/<name>');

export const contactPhone = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!/^[+0-9 ()-]+$/.test(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'phone number must contain exactly 11 digits' });
      return z.NEVER;
    }
    const digits = value.replace(/\D/g, '');
    const canonical = digits.length === 12 && digits.startsWith('63') ? `0${digits.slice(2)}` : digits;
    if (!/^\d{11}$/.test(canonical)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'phone number must contain exactly 11 digits' });
      return z.NEVER;
    }
    return canonical;
  });

/** Fixed palettes so every storefront stays readable; the owner picks one, not raw colours. */
export const storefrontTheme = z.enum(['ivory', 'sage', 'blush', 'noir']);
export type StorefrontTheme = z.infer<typeof storefrontTheme>;

export interface StorefrontPalette {
  label: string;
  background: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  /** Text colour on an `accent` fill. */
  accentInk: string;
}

/**
 * The four palettes, shared by the owner's theme picker and the public storefront so a preview is
 * exactly what renders. Ink on background is at least 7:1, and accent pairs are at least 4.5:1.
 */
export const STOREFRONT_THEMES: Record<StorefrontTheme, StorefrontPalette> = {
  ivory: { label: 'Ivory', background: '#FBF8F3', surface: '#FFFFFF', ink: '#1F1B16', muted: '#6B6258', line: '#E7E0D5', accent: '#1F1B16', accentInk: '#FBF8F3' },
  sage: { label: 'Sage', background: '#F5F4EC', surface: '#FFFFFF', ink: '#26291C', muted: '#62664F', line: '#E0DECF', accent: '#3C3F24', accentInk: '#F5F4EC' },
  blush: { label: 'Blush', background: '#FBF4F1', surface: '#FFFFFF', ink: '#2B1F1C', muted: '#735F5A', line: '#EEDFDA', accent: '#8F4E47', accentInk: '#FFFFFF' },
  noir: { label: 'Noir', background: '#141312', surface: '#1C1A18', ink: '#F3EEE7', muted: '#A9A097', line: '#2F2C29', accent: '#D8C3A5', accentInk: '#141312' },
};

export const storefrontBranding = z
  .object({
    display_name: plainText(80, { min: 1 }),
    tagline: optionalText(120),
    description: optionalText(600, true),
    logo_file_id: fileObjectId.nullable(),
    cover_file_id: fileObjectId.nullable(),
    theme: storefrontTheme,
  })
  .strict();
export type StorefrontBranding = z.infer<typeof storefrontBranding>;

export const storefrontContact = z
  .object({
    phone: contactPhone.nullable(),
    email: z.string().trim().toLowerCase().email().max(254).nullable(),
    address: optionalText(300, true),
    instagram: socialHandle.nullable(),
    facebook: facebookPage.nullable(),
    tiktok: socialHandle.nullable(),
  })
  .strict();
export type StorefrontContact = z.infer<typeof storefrontContact>;

export const storefrontSections = z
  .object({
    categories: z.boolean(),
    featured: z.boolean(),
    new_arrivals: z.boolean(),
    how_it_works: z.boolean(),
    about: z.boolean(),
    rental_info: z.boolean(),
    fitting: z.boolean(),
  })
  .strict();
export type StorefrontSections = z.infer<typeof storefrontSections>;

export const MAX_FEATURED_PRODUCTS = 12;

export const storefrontContent = z
  .object({
    announcement: optionalText(120),
    hero: z
      .object({
        heading: plainText(80, { min: 1 }),
        body: optionalText(240, true),
        image_file_id: fileObjectId.nullable(),
      })
      .strict(),
    about: z
      .object({
        heading: optionalText(80),
        body: optionalText(1500, true),
        image_file_id: fileObjectId.nullable(),
      })
      .strict(),
    sections: storefrontSections,
    featured_product_ids: z
      .array(productId)
      .max(MAX_FEATURED_PRODUCTS)
      .refine((ids) => new Set(ids).size === ids.length, 'featured clothing must not repeat'),
  })
  .strict();
export type StorefrontContent = z.infer<typeof storefrontContent>;

/** Which optional guest details the business asks for. Name, email, and address are always required. */
export const fieldRequirement = z.enum(['required', 'optional', 'hidden']);
export type FieldRequirement = z.infer<typeof fieldRequirement>;

export const storefrontCheckout = z
  .object({
    requirements: z
      .object({
        phone: fieldRequirement,
        social_handle: fieldRequirement,
        event_date: fieldRequirement,
      })
      .strict(),
    /** Local time the garment is handed over and due back, e.g. "10:00". */
    handover_time: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, 'use a half-hour time such as 10:00'),
    min_notice_days: z.number().int().min(0).max(60),
    max_rental_days: z.number().int().min(1).max(30),
    fitting_requests: z.boolean(),
  })
  .strict();
export type StorefrontCheckout = z.infer<typeof storefrontCheckout>;

/** The whole editable document. It is saved as one unit so a half-saved storefront cannot exist. */
export const storefrontDocument = z
  .object({
    branding: storefrontBranding,
    contact: storefrontContact,
    content: storefrontContent,
    checkout: storefrontCheckout,
  })
  .strict();
export type StorefrontDocument = z.infer<typeof storefrontDocument>;

/**
 * Customer-facing rental policy. Saved as a new immutable version each time, because reservations
 * keep a reference to the exact version the guest accepted.
 */
export const storefrontPolicyRules = z
  .object({
    rental: plainText(1500, { min: 1, multiline: true }),
    deposit: plainText(1000, { min: 1, multiline: true }),
    cancellation: plainText(1500, { min: 1, multiline: true }),
    damage: optionalText(1000, true),
    delivery: z
      .object({
        enabled: z.boolean(),
        fee_minor: nonNegativeMoneyString.refine((value) => BigInt(value) <= 2_147_483_647n, 'fee is too large'),
        notes: optionalText(600, true),
      })
      .strict(),
    privacy_notice: plainText(2000, { min: 1, multiline: true }),
  })
  .strict();
export type StorefrontPolicyRules = z.infer<typeof storefrontPolicyRules>;

export const storefrontStatusValue = z.enum(['draft', 'published', 'suspended']);
export type StorefrontStatusValue = z.infer<typeof storefrontStatusValue>;

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'dashboard', 'drezivo', 'guest', 'help', 'login', 'new',
  'pricing', 'privacy', 'settings', 'signin', 'signup', 'static', 'store', 'support', 'terms',
]);

export const storefrontSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, 'use 3–50 lowercase letters, numbers, or hyphens')
  .refine((value) => !value.includes('--'), 'hyphens must not repeat')
  .refine((value) => !RESERVED_SLUGS.has(value), 'this address is reserved');

export const storefrontReadiness = z
  .object({
    has_policy: z.boolean(),
    has_active_clothing: z.boolean(),
    has_storefront_payment_method: z.boolean(),
    has_contact: z.boolean(),
    ready: z.boolean(),
  })
  .strict();
export type StorefrontReadiness = z.infer<typeof storefrontReadiness>;

/** Short-lived signed previews of the images referenced by the document. */
export const storefrontMedia = z
  .object({
    logo_url: z.string().url().nullable(),
    cover_url: z.string().url().nullable(),
    hero_image_url: z.string().url().nullable(),
    about_image_url: z.string().url().nullable(),
  })
  .strict();

/** GET /storefront response. */
export const storefrontSettings = z
  .object({
    slug: storefrontSlug,
    status: storefrontStatusValue,
    version: z.number().int().positive(),
    published_at: isoInstant.nullable(),
    updated_at: isoInstant,
    public_path: z.string().startsWith('/s/'),
    document: storefrontDocument,
    media: storefrontMedia,
    policy: z
      .object({
        version: z.number().int().positive(),
        effective_at: isoInstant,
        rules: storefrontPolicyRules.nullable(),
      })
      .strict(),
    readiness: storefrontReadiness,
  })
  .strict();
export type StorefrontSettings = z.infer<typeof storefrontSettings>;

/**
 * A short-lived, read-only credential that lets the owner view the storefront before it is
 * published. The app hands it to the storefront in a POST body, never in a URL.
 */
export const storefrontPreviewLink = z
  .object({
    slug: storefrontSlug,
    token: z.string().min(1).max(200),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type StorefrontPreviewLink = z.infer<typeof storefrontPreviewLink>;

/** PATCH /storefront. */
export const updateStorefrontRequest = z
  .object({ version: z.number().int().positive(), document: storefrontDocument })
  .strict();
export type UpdateStorefrontRequest = z.infer<typeof updateStorefrontRequest>;

/** POST /storefront/slug. */
export const updateStorefrontSlugRequest = z
  .object({ version: z.number().int().positive(), slug: storefrontSlug })
  .strict();
export type UpdateStorefrontSlugRequest = z.infer<typeof updateStorefrontSlugRequest>;

/** POST /storefront/publish and /storefront/unpublish. */
export const storefrontTransitionRequest = z
  .object({ version: z.number().int().positive() })
  .strict();
export type StorefrontTransitionRequest = z.infer<typeof storefrontTransitionRequest>;

/** POST /storefront/policies. `expected_version` is the policy version the owner was editing. */
export const publishStorefrontPolicyRequest = z
  .object({ expected_version: z.number().int().positive(), rules: storefrontPolicyRules })
  .strict();
export type PublishStorefrontPolicyRequest = z.infer<typeof publishStorefrontPolicyRequest>;

/** Starting document for a storefront the owner has never edited. */
export function defaultStorefrontDocument(businessName: string): StorefrontDocument {
  return {
    branding: {
      display_name: businessName.slice(0, 80),
      tagline: null,
      description: null,
      logo_file_id: null,
      cover_file_id: null,
      theme: 'ivory',
    },
    contact: { phone: null, email: null, address: null, instagram: null, facebook: null, tiktok: null },
    content: {
      announcement: null,
      hero: { heading: businessName.slice(0, 80), body: null, image_file_id: null },
      about: { heading: null, body: null, image_file_id: null },
      sections: {
        categories: true,
        featured: true,
        new_arrivals: true,
        how_it_works: true,
        about: true,
        rental_info: true,
        fitting: false,
      },
      featured_product_ids: [],
    },
    checkout: {
      requirements: { phone: 'required', social_handle: 'optional', event_date: 'optional' },
      handover_time: '10:00',
      min_notice_days: 1,
      max_rental_days: 7,
      fitting_requests: false,
    },
  };
}
