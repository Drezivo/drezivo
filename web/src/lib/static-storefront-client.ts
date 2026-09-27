export type StaticAvailabilityStatus = 'available' | 'reserved' | 'rented' | 'unavailable';

export interface StaticStoreCategory {
  id: string;
  name: string;
  count: number;
}

export interface StaticStoreProjection {
  slug: string;
  displayName: string;
  shortDescription?: string;
  coverImageUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  categories: StaticStoreCategory[];
  policies: {
    rentalDurationLabel?: string;
    securityDepositLabel?: string;
    pickupReturnInfo?: string;
    deliveryInfo?: string;
    cancellationPolicy?: string;
  };
}

export interface StaticCatalogItemSummary {
  id: string;
  categoryId?: string;
  categoryName: string;
  name: string;
  primaryImageUrl: string;
  priceDecimal: string;
  rentalUnitLabel: string;
  sizes: readonly string[];
  availabilityStatus: StaticAvailabilityStatus;
}

export interface StaticCatalogItemDetail extends StaticCatalogItemSummary {
  description: string;
  images: string[];
  measurements: Array<{ label: string; value: string }>;
  securityDepositDecimal: string;
  rentalDurationDays: number;
  variantId: string;
}

export interface StaticCatalogListResponse {
  items: StaticCatalogItemSummary[];
  categories: StaticStoreCategory[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StaticAvailabilityResponse {
  unavailableDates: string[];
}

export interface StaticCreateHoldBody {
  itemId: string;
  variantId: string;
  size: string;
  pickupDate: string;
  returnDate: string;
}

export interface StaticCreateHoldResponse {
  reservationId: string;
  capabilityToken: string;
  expiresAt: string;
}

const PLACEHOLDER_IMAGE = '/storefront-demo/dress-placeholder.svg';
const NOT_FOUND_DEMO_SLUG = 'this-slug-does-not-exist-12345';

const CATEGORIES: StaticStoreCategory[] = [
  { id: 'gowns', name: 'Gowns', count: 3 },
  { id: 'dresses', name: 'Dresses', count: 2 },
  { id: 'filipiniana', name: 'Filipiniana', count: 1 },
  { id: 'formal-wear', name: 'Formal Wear', count: 2 },
];

const ITEMS: StaticCatalogItemDetail[] = [
  {
    id: 'emerald-evening-gown',
    categoryId: 'gowns',
    categoryName: 'Gowns',
    name: 'Emerald Evening Gown',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '1800.00',
    rentalUnitLabel: '3 days',
    sizes: ['S', 'M', 'L'],
    availabilityStatus: 'available',
    description:
      'An elegant emerald gown with a clean fitted silhouette, ideal for formal events, debuts, and evening celebrations.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '86–91 cm' },
      { label: 'Waist', value: '66–71 cm' },
      { label: 'Hips', value: '91–96 cm' },
      { label: 'Length', value: '150 cm' },
    ],
    securityDepositDecimal: '2000.00',
    rentalDurationDays: 3,
    variantId: 'variant-emerald-m',
  },
  {
    id: 'rose-satin-gown',
    categoryId: 'gowns',
    categoryName: 'Gowns',
    name: 'Rose Satin Gown',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '1650.00',
    rentalUnitLabel: '3 days',
    sizes: ['XS', 'S', 'M'],
    availabilityStatus: 'reserved',
    description:
      'A soft rose satin gown with a subtle sheen and flowing skirt for weddings, birthdays, and formal occasions.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '81–89 cm' },
      { label: 'Waist', value: '61–69 cm' },
      { label: 'Hips', value: '89–94 cm' },
      { label: 'Length', value: '147 cm' },
    ],
    securityDepositDecimal: '1800.00',
    rentalDurationDays: 3,
    variantId: 'variant-rose-s',
  },
  {
    id: 'black-classic-gown',
    categoryId: 'gowns',
    categoryName: 'Gowns',
    name: 'Black Classic Gown',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '1500.00',
    rentalUnitLabel: '3 days',
    sizes: ['M', 'L', 'XL'],
    availabilityStatus: 'available',
    description:
      'A timeless black formal gown designed for elegant evening events and simple styling.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '91–99 cm' },
      { label: 'Waist', value: '71–79 cm' },
      { label: 'Hips', value: '96–104 cm' },
      { label: 'Length', value: '151 cm' },
    ],
    securityDepositDecimal: '1800.00',
    rentalDurationDays: 3,
    variantId: 'variant-black-l',
  },
  {
    id: 'champagne-midi-dress',
    categoryId: 'dresses',
    categoryName: 'Dresses',
    name: 'Champagne Midi Dress',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '950.00',
    rentalUnitLabel: '2 days',
    sizes: ['S', 'M'],
    availabilityStatus: 'available',
    description:
      'A refined champagne midi dress for intimate celebrations, dinners, and semi-formal events.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '84–91 cm' },
      { label: 'Waist', value: '64–72 cm' },
      { label: 'Hips', value: '91–98 cm' },
      { label: 'Length', value: '118 cm' },
    ],
    securityDepositDecimal: '1200.00',
    rentalDurationDays: 2,
    variantId: 'variant-champagne-m',
  },
  {
    id: 'navy-cocktail-dress',
    categoryId: 'dresses',
    categoryName: 'Dresses',
    name: 'Navy Cocktail Dress',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '850.00',
    rentalUnitLabel: '2 days',
    sizes: ['XS', 'S', 'M', 'L'],
    availabilityStatus: 'rented',
    description:
      'A clean navy cocktail silhouette suited for graduations, receptions, and evening celebrations.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '81–94 cm' },
      { label: 'Waist', value: '61–74 cm' },
      { label: 'Hips', value: '89–101 cm' },
      { label: 'Length', value: '105 cm' },
    ],
    securityDepositDecimal: '1000.00',
    rentalDurationDays: 2,
    variantId: 'variant-navy-m',
  },
  {
    id: 'modern-filipiniana',
    categoryId: 'filipiniana',
    categoryName: 'Filipiniana',
    name: 'Modern Filipiniana',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '2200.00',
    rentalUnitLabel: '3 days',
    sizes: ['S', 'M', 'L'],
    availabilityStatus: 'available',
    description:
      'A modern Filipiniana-inspired formal piece with statement sleeves for cultural, formal, and special events.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Bust', value: '84–96 cm' },
      { label: 'Waist', value: '64–76 cm' },
      { label: 'Hips', value: '91–102 cm' },
      { label: 'Length', value: '145 cm' },
    ],
    securityDepositDecimal: '2500.00',
    rentalDurationDays: 3,
    variantId: 'variant-filipiniana-m',
  },
  {
    id: 'midnight-tuxedo-set',
    categoryId: 'formal-wear',
    categoryName: 'Formal Wear',
    name: 'Midnight Tuxedo Set',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '1400.00',
    rentalUnitLabel: '3 days',
    sizes: ['M', 'L', 'XL'],
    availabilityStatus: 'available',
    description:
      'A classic midnight formal set for weddings, corporate events, proms, and formal celebrations.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Chest', value: '96–107 cm' },
      { label: 'Waist', value: '81–91 cm' },
      { label: 'Sleeve', value: '61 cm' },
      { label: 'Trouser Length', value: '104 cm' },
    ],
    securityDepositDecimal: '1600.00',
    rentalDurationDays: 3,
    variantId: 'variant-tuxedo-l',
  },
  {
    id: 'classic-barong-set',
    categoryId: 'formal-wear',
    categoryName: 'Formal Wear',
    name: 'Classic Barong Set',
    primaryImageUrl: PLACEHOLDER_IMAGE,
    priceDecimal: '1100.00',
    rentalUnitLabel: '3 days',
    sizes: ['S', 'M', 'L', 'XL'],
    availabilityStatus: 'unavailable',
    description:
      'A clean traditional barong set suitable for weddings, ceremonies, graduations, and formal gatherings.',
    images: [PLACEHOLDER_IMAGE, PLACEHOLDER_IMAGE],
    measurements: [
      { label: 'Chest', value: '91–107 cm' },
      { label: 'Waist', value: '76–94 cm' },
      { label: 'Sleeve', value: '60 cm' },
      { label: 'Length', value: '74 cm' },
    ],
    securityDepositDecimal: '1300.00',
    rentalDurationDays: 3,
    variantId: 'variant-barong-m',
  },
];

function buildStore(slug: string): StaticStoreProjection {
  return {
    slug,
    displayName: 'Luxe Rental Studio',
    shortDescription:
      'Curated gowns, dresses, Filipiniana, and formal wear for weddings, debuts, graduations, and special events.',
    coverImageUrl: PLACEHOLDER_IMAGE,
    contactPhone: '+63 917 555 0148',
    contactEmail: 'hello@luxerental.test',
    address: 'Quezon City, Metro Manila',
    categories: CATEGORIES,
    policies: {
      rentalDurationLabel: 'Most items include a 2–3 day rental period depending on the selected piece.',
      securityDepositLabel: 'A refundable security deposit is shown separately before you continue.',
      pickupReturnInfo: 'Pickup and return instructions are confirmed with the business after review.',
      deliveryInfo: 'Self pickup and local delivery are available for this static storefront preview.',
      cancellationPolicy: 'Cancellation rules are reviewed with the customer before the reservation is confirmed.',
    },
  };
}

function itemSummary(item: StaticCatalogItemDetail): StaticCatalogItemSummary {
  const {
    description: _description,
    images: _images,
    measurements: _measurements,
    securityDepositDecimal: _securityDepositDecimal,
    rentalDurationDays: _rentalDurationDays,
    variantId: _variantId,
    ...summary
  } = item;
  return summary;
}

function buildUnavailableDates(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return [5, 10, 11, 18, 24].map((day) => `${month}-${String(day).padStart(2, '0')}`);
}

export const staticStorefrontClient = {
  async getStore(slug: string): Promise<StaticStoreProjection | null> {
    if (!slug || slug === NOT_FOUND_DEMO_SLUG) return null;
    return buildStore(slug);
  },

  async getCatalog(
    slug: string,
    filters: Record<string, string | undefined>,
  ): Promise<StaticCatalogListResponse> {
    if (!slug || slug === NOT_FOUND_DEMO_SLUG) {
      return { items: [], categories: [], total: 0, page: 1, pageSize: 20 };
    }

    const q = (filters.q ?? '').trim().toLowerCase();
    const category = filters.category;
    const size = filters.size;
    const page = Math.max(1, Number(filters.page ?? '1') || 1);
    const pageSize = Math.max(1, Number(filters.pageSize ?? '20') || 20);

    const filtered = ITEMS.filter((item) => {
      const matchesQuery =
        !q || item.name.toLowerCase().includes(q) || item.categoryName.toLowerCase().includes(q);
      const matchesCategory = !category || item.categoryId === category;
      const matchesSize = !size || item.sizes.includes(size);
      return matchesQuery && matchesCategory && matchesSize;
    });

    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize).map(itemSummary);

    const categories = CATEGORIES.map((entry) => ({
      ...entry,
      count: filtered.filter((item) => item.categoryId === entry.id).length,
    }));

    return {
      items: pageItems,
      categories,
      total: filtered.length,
      page,
      pageSize,
    };
  },

  async getCatalogItem(slug: string, itemId: string): Promise<StaticCatalogItemDetail | null> {
    if (!slug || slug === NOT_FOUND_DEMO_SLUG) return null;
    return ITEMS.find((item) => item.id === itemId) ?? null;
  },

  async getAvailability(
    slug: string,
    itemId: string,
    month: string,
  ): Promise<StaticAvailabilityResponse> {
    if (!slug || !ITEMS.some((item) => item.id === itemId)) return { unavailableDates: [] };
    return { unavailableDates: buildUnavailableDates(month) };
  },

  async createHold(
    slug: string,
    body: StaticCreateHoldBody,
    _idempotencyKey: string,
  ): Promise<StaticCreateHoldResponse> {
    const encoded = encodeStaticReservationState({
      storeSlug: slug,
      itemId: body.itemId,
      size: body.size,
      pickupDate: body.pickupDate,
      returnDate: body.returnDate,
      status: 'held',
    });

    return {
      reservationId: encoded,
      capabilityToken: `static-capability-${encoded}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  },
};

export interface StaticReservationStateSeed {
  storeSlug: string;
  itemId: string;
  size: string;
  pickupDate: string;
  returnDate: string;
  status: 'held' | 'pending_confirmation';
  fullName?: string;
  phone?: string;
  email?: string;
  eventDate?: string;
  pickupMethod?: 'self_pickup' | 'delivery';
  deliveryAddress?: string;
  paymentMethod?: 'gcash' | 'maya' | 'cash';
}

const STATIC_RESERVATION_PREFIX = 'static.';

function encodeUtf8Base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeUtf8Base64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeStaticReservationState(state: StaticReservationStateSeed): string {
  return `${STATIC_RESERVATION_PREFIX}${encodeUtf8Base64Url(JSON.stringify(state))}`;
}

export function decodeStaticReservationState(value: string): StaticReservationStateSeed | null {
  if (!value.startsWith(STATIC_RESERVATION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeUtf8Base64Url(value.slice(STATIC_RESERVATION_PREFIX.length))) as StaticReservationStateSeed;
    if (!parsed.storeSlug || !parsed.itemId || !parsed.size || !parsed.pickupDate || !parsed.returnDate) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getStaticItem(itemId: string): StaticCatalogItemDetail | null {
  return ITEMS.find((item) => item.id === itemId) ?? null;
}

export function getStaticStore(slug: string): StaticStoreProjection | null {
  if (!slug || slug === NOT_FOUND_DEMO_SLUG) return null;
  return buildStore(slug);
}
