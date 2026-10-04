/**
 * Storefront CMS — the owner-edited content behind `/s/<slug>`.
 *
 * Everything the owner can type is plain, bounded text. Markup is never stored or rendered, and
 * social profile input is normalized to handles so the public URL is always built by the server
 * from a fixed host, and unrelated links cannot be stored. Images are referenced by accepted
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

function socialProfileInput(
  platform: string,
  hosts: readonly string[],
  profileFromPath: (path: string) => string | null,
  handleSchema: z.ZodType<string>,
) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return value;

      let url: URL;
      try {
        url = new URL(value);
      } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `enter a ${platform} handle or canonical profile URL` });
        return z.NEVER;
      }

      const rawAuthority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? '';
      const rawPath = value.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? '';
      const pathMatch = rawPath.match(/^\/([^/]+)\/?$/);
      const profile = pathMatch ? profileFromPath(pathMatch[1]!) : null;
      const isSupportedUrl =
        /^https:\/\//i.test(value) &&
        hosts.includes(url.hostname) &&
        rawAuthority.toLowerCase() === url.hostname &&
        url.port === '' &&
        url.username === '' &&
        url.password === '' &&
        !value.includes('?') &&
        !value.includes('#') &&
        url.pathname === rawPath &&
        profile !== null;

      if (!isSupportedUrl) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `enter a ${platform} handle or canonical profile URL` });
        return z.NEVER;
      }

      return profile;
    })
    .pipe(handleSchema);
}

const instagramProfile = socialProfileInput(
  'Instagram',
  ['instagram.com', 'www.instagram.com'],
  (path) => (path.startsWith('@') ? null : path),
  socialHandle,
);
const facebookProfile = socialProfileInput(
  'Facebook',
  ['facebook.com', 'www.facebook.com'],
  (path) => path,
  facebookPage,
);
const tiktokProfile = socialProfileInput(
  'TikTok',
  ['tiktok.com', 'www.tiktok.com'],
  (path) => (path.startsWith('@') ? path.slice(1) : null),
  socialHandle,
);

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
    instagram: instagramProfile.nullable(),
    facebook: facebookProfile.nullable(),
    tiktok: tiktokProfile.nullable(),
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

/** Most pages a rental-terms document photographed or exported as images can have. */
export const STOREFRONT_POLICY_IMAGE_LIMIT = 6;

/**
 * How the rental terms are shown: typed text, or the shop's existing policy as images (one per
 * page, in order). The privacy notice and delivery settings stay structured text either way.
 */
export const storefrontPolicyFormat = z.enum(['text', 'images']);
export type StorefrontPolicyFormat = z.infer<typeof storefrontPolicyFormat>;

const REQUIRED_TEXT_TERMS = ['rental', 'deposit', 'cancellation'] as const;

/**
 * Customer-facing rental policy. Saved as a new immutable version each time, because reservations
 * keep a reference to the exact version the guest accepted. Versions saved before `format` existed
 * read back as text.
 */
export const storefrontPolicyRules = z
  .object({
    format: storefrontPolicyFormat.default('text'),
    rental: plainText(1500, { multiline: true }),
    deposit: plainText(1000, { multiline: true }),
    cancellation: plainText(1500, { multiline: true }),
    damage: optionalText(1000, true),
    image_file_ids: z.array(fileObjectId).max(STOREFRONT_POLICY_IMAGE_LIMIT).default([]),
    delivery: z
      .object({
        enabled: z.boolean(),
        fee_minor: nonNegativeMoneyString.refine((value) => BigInt(value) <= 2_147_483_647n, 'fee is too large'),
        notes: optionalText(600, true),
      })
      .strict(),
    privacy_notice: plainText(2000, { min: 1, multiline: true }),
  })
  .strict()
  .superRefine((rules, ctx) => {
    if (rules.format === 'text') {
      for (const key of REQUIRED_TEXT_TERMS) {
        if (rules[key].length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'required' });
      }
      return;
    }
    if (rules.image_file_ids.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['image_file_ids'], message: 'add at least one image of your policy' });
    }
    if (new Set(rules.image_file_ids).size !== rules.image_file_ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['image_file_ids'], message: 'each image can be added once' });
    }
  });
export type StorefrontPolicyRules = z.infer<typeof storefrontPolicyRules>;

export const storefrontStatusValue = z.enum(['draft', 'published', 'suspended']);
export type StorefrontStatusValue = z.infer<typeof storefrontStatusValue>;

export const STOREFRONT_SLUG_MIN_LENGTH = 3;
export const STOREFRONT_SLUG_MAX_LENGTH = 50;

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'dashboard', 'drezivo', 'guest', 'help', 'login', 'new',
  'pricing', 'privacy', 'settings', 'signin', 'signup', 'static', 'store', 'support', 'terms',
]);
const STOREFRONT_SLUG_PATTERN = new RegExp(
  `^[a-z0-9](?:[a-z0-9-]{${STOREFRONT_SLUG_MIN_LENGTH - 2},${STOREFRONT_SLUG_MAX_LENGTH - 2}}[a-z0-9])$`,
);

export const storefrontSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(STOREFRONT_SLUG_PATTERN, 'use 3–50 lowercase letters, numbers, or hyphens')
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
        /** Signed, short-lived URLs of the policy images, keyed by file id, for the editor preview. */
        image_urls: z.record(z.string(), z.string().url()).default({}),
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
