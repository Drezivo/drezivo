import { createClothingRequest, type CreateClothingRequest } from '@drezivo/contracts';

export interface LocalClothingSeedItem {
  code: string;
  name: string;
  description: string;
  categoryName: string;
  subcategory: string;
  color: string;
  sizeLabel: string | null;
  rentalPriceMinor: string;
  securityDepositMinor: string;
  extraDayPriceMinor: string;
}

export const LOCAL_CLOTHING_SEED: readonly LocalClothingSeedItem[] = [
  {
    code: 'LOCAL-SEED-001',
    name: 'Champagne Satin A-Line Gown',
    description: 'Synthetic local-dev sample: a floor-length satin A-line gown for formal events.',
    categoryName: 'Gowns',
    subcategory: 'Evening gown',
    color: 'Champagne',
    sizeLabel: 'M',
    rentalPriceMinor: '65000',
    securityDepositMinor: '100000',
    extraDayPriceMinor: '15000',
  },
  {
    code: 'LOCAL-SEED-002',
    name: 'Midnight Velvet Ball Gown',
    description: 'Synthetic local-dev sample: a full-skirt velvet ball gown with a fitted bodice.',
    categoryName: 'Gowns',
    subcategory: 'Ball gown',
    color: 'Midnight blue',
    sizeLabel: 'L',
    rentalPriceMinor: '78000',
    securityDepositMinor: '120000',
    extraDayPriceMinor: '18000',
  },
  {
    code: 'LOCAL-SEED-003',
    name: 'Rose Gold Sequin Mermaid Gown',
    description: 'Synthetic local-dev sample: a shimmering mermaid gown for evening celebrations.',
    categoryName: 'Gowns',
    subcategory: 'Mermaid gown',
    color: 'Rose gold',
    sizeLabel: 'S',
    rentalPriceMinor: '72000',
    securityDepositMinor: '110000',
    extraDayPriceMinor: '17000',
  },
  {
    code: 'LOCAL-SEED-004',
    name: 'Emerald Off-Shoulder Evening Gown',
    description: 'Synthetic local-dev sample: an off-shoulder gown in a rich emerald tone.',
    categoryName: 'Gowns',
    subcategory: 'Evening gown',
    color: 'Emerald',
    sizeLabel: 'XL',
    rentalPriceMinor: '68000',
    securityDepositMinor: '100000',
    extraDayPriceMinor: '16000',
  },
  {
    code: 'LOCAL-SEED-005',
    name: 'Ivory Bridal Reception Gown',
    description:
      'Synthetic local-dev sample: a lightweight ivory gown for a reception or civil ceremony.',
    categoryName: 'Gowns',
    subcategory: 'Bridal gown',
    color: 'Ivory',
    sizeLabel: 'M',
    rentalPriceMinor: '95000',
    securityDepositMinor: '150000',
    extraDayPriceMinor: '22000',
  },
  {
    code: 'LOCAL-SEED-006',
    name: 'Black Tuxedo Suit Set',
    description: 'Synthetic local-dev sample: a classic black tuxedo set for formal occasions.',
    categoryName: 'Formal Wear',
    subcategory: 'Tuxedo',
    color: 'Black',
    sizeLabel: 'M',
    rentalPriceMinor: '85000',
    securityDepositMinor: '130000',
    extraDayPriceMinor: '20000',
  },
  {
    code: 'LOCAL-SEED-007',
    name: 'Navy Slim-Fit Suit Set',
    description: 'Synthetic local-dev sample: a modern navy suit set with a slim silhouette.',
    categoryName: 'Formal Wear',
    subcategory: 'Suit',
    color: 'Navy',
    sizeLabel: 'L',
    rentalPriceMinor: '75000',
    securityDepositMinor: '120000',
    extraDayPriceMinor: '18000',
  },
  {
    code: 'LOCAL-SEED-008',
    name: 'Charcoal Three-Piece Suit',
    description:
      'Synthetic local-dev sample: a charcoal three-piece suit for business or formal wear.',
    categoryName: 'Formal Wear',
    subcategory: 'Three-piece suit',
    color: 'Charcoal',
    sizeLabel: 'XL',
    rentalPriceMinor: '82000',
    securityDepositMinor: '125000',
    extraDayPriceMinor: '19000',
  },
  {
    code: 'LOCAL-SEED-009',
    name: 'Burgundy Cocktail Dress',
    description: 'Synthetic local-dev sample: a knee-length cocktail dress in burgundy.',
    categoryName: 'Dresses',
    subcategory: 'Cocktail dress',
    color: 'Burgundy',
    sizeLabel: 'S',
    rentalPriceMinor: '42000',
    securityDepositMinor: '65000',
    extraDayPriceMinor: '10000',
  },
  {
    code: 'LOCAL-SEED-010',
    name: 'Floral Midi Wrap Dress',
    description: 'Synthetic local-dev sample: a floral-print midi wrap dress for daytime events.',
    categoryName: 'Dresses',
    subcategory: 'Midi dress',
    color: 'Floral print',
    sizeLabel: 'M',
    rentalPriceMinor: '38000',
    securityDepositMinor: '60000',
    extraDayPriceMinor: '9000',
  },
  {
    code: 'LOCAL-SEED-011',
    name: 'Classic Filipiniana Terno',
    description: 'Synthetic local-dev sample: a formal terno-inspired Filipiniana ensemble.',
    categoryName: 'Filipiniana',
    subcategory: 'Terno',
    color: 'Ivory',
    sizeLabel: 'M',
    rentalPriceMinor: '88000',
    securityDepositMinor: '140000',
    extraDayPriceMinor: '21000',
  },
  {
    code: 'LOCAL-SEED-012',
    name: 'Butterfly-Sleeve Filipiniana Gown',
    description:
      'Synthetic local-dev sample: a Filipiniana gown with structured butterfly sleeves.',
    categoryName: 'Filipiniana',
    subcategory: 'Evening terno',
    color: 'Royal blue',
    sizeLabel: 'L',
    rentalPriceMinor: '92000',
    securityDepositMinor: '145000',
    extraDayPriceMinor: '22000',
  },
  {
    code: 'LOCAL-SEED-013',
    name: 'Embroidered Ivory Barong Tagalog',
    description: 'Synthetic local-dev sample: a formal barong with embroidered front panels.',
    categoryName: 'Barong',
    subcategory: 'Formal barong',
    color: 'Ivory',
    sizeLabel: 'L',
    rentalPriceMinor: '58000',
    securityDepositMinor: '90000',
    extraDayPriceMinor: '14000',
  },
  {
    code: 'LOCAL-SEED-014',
    name: 'Natural Piña-Fabric Barong',
    description: 'Synthetic local-dev sample: a light-colored barong-inspired formal top.',
    categoryName: 'Barong',
    subcategory: 'Formal barong',
    color: 'Natural',
    sizeLabel: 'XL',
    rentalPriceMinor: '68000',
    securityDepositMinor: '105000',
    extraDayPriceMinor: '16000',
  },
  {
    code: 'LOCAL-SEED-015',
    name: 'Silver Stage Performance Costume',
    description:
      'Synthetic local-dev sample: a silver performance costume for stage and themed events.',
    categoryName: 'Costumes',
    subcategory: 'Stage costume',
    color: 'Silver',
    sizeLabel: null,
    rentalPriceMinor: '50000',
    securityDepositMinor: '80000',
    extraDayPriceMinor: '12000',
  },
  {
    code: 'LOCAL-SEED-016',
    name: 'Red Festival Dance Costume',
    description:
      'Synthetic local-dev sample: a bright red costume for festival or dance performances.',
    categoryName: 'Costumes',
    subcategory: 'Festival costume',
    color: 'Red',
    sizeLabel: null,
    rentalPriceMinor: '46000',
    securityDepositMinor: '70000',
    extraDayPriceMinor: '11000',
  },
  {
    code: 'LOCAL-SEED-017',
    name: 'Storybook Prince Costume',
    description:
      "Synthetic local-dev sample: a children's storybook prince costume for dress-up events.",
    categoryName: 'Costumes',
    subcategory: 'Children’s costume',
    color: 'Royal blue',
    sizeLabel: null,
    rentalPriceMinor: '35000',
    securityDepositMinor: '55000',
    extraDayPriceMinor: '8000',
  },
  {
    code: 'LOCAL-SEED-018',
    name: 'Classic Black Cocktail Dress',
    description: 'Synthetic local-dev sample: a versatile black cocktail dress for evening events.',
    categoryName: 'Dresses',
    subcategory: 'Cocktail dress',
    color: 'Black',
    sizeLabel: 'XL',
    rentalPriceMinor: '44000',
    securityDepositMinor: '70000',
    extraDayPriceMinor: '10000',
  },
  {
    code: 'LOCAL-SEED-019',
    name: 'Champagne Bridesmaid Gown',
    description: 'Synthetic local-dev sample: a soft champagne gown suited to a wedding party.',
    categoryName: 'Gowns',
    subcategory: 'Bridesmaid gown',
    color: 'Champagne',
    sizeLabel: 'S',
    rentalPriceMinor: '62000',
    securityDepositMinor: '95000',
    extraDayPriceMinor: '15000',
  },
  {
    code: 'LOCAL-SEED-020',
    name: 'Cream Formal Barong Set',
    description: 'Synthetic local-dev sample: a cream-colored formal barong set for celebrations.',
    categoryName: 'Barong',
    subcategory: 'Formal barong',
    color: 'Cream',
    sizeLabel: null,
    rentalPriceMinor: '60000',
    securityDepositMinor: '95000',
    extraDayPriceMinor: '14000',
  },
] as const;

export interface LocalSeedArguments {
  storefrontSlug: string;
  apply: boolean;
  help: boolean;
}

export function parseLocalSeedArguments(args: readonly string[]): LocalSeedArguments {
  let storefrontSlug: string | undefined;
  let apply = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--apply') {
      if (apply) throw new Error('--apply may only be specified once.');
      apply = true;
      continue;
    }
    if (argument === '--storefront-slug') {
      if (storefrontSlug !== undefined)
        throw new Error('--storefront-slug may only be specified once.');
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--storefront-slug requires a value.');
      storefrontSlug = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!help && !storefrontSlug) throw new Error('--storefront-slug is required.');
  if (storefrontSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storefrontSlug)) {
    throw new Error(
      'The storefront slug must contain lowercase letters, numbers, and single hyphens.',
    );
  }

  return { storefrontSlug: storefrontSlug ?? '', apply, help };
}

export function isLoopbackPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function canRunLocalClothingSeed(nodeEnv: string, databaseUrl: string): boolean {
  return nodeEnv === 'development' && isLoopbackPostgresUrl(databaseUrl);
}

export function buildLocalClothingRequest(
  item: LocalClothingSeedItem,
  categoryId: string,
): CreateClothingRequest {
  return createClothingRequest.parse({
    name: item.name,
    code: item.code,
    description: item.description,
    subcategory: item.subcategory,
    category_id: categoryId,
    color_label: item.color,
    image_file_ids: [],
    sizes: [
      {
        size_label: item.sizeLabel,
        measurement_mode: 'none',
        measurement_unit: 'cm',
        measurements: {},
      },
    ],
    sizing_mode: item.sizeLabel === null ? 'free_size' : 'sized',
    pricing: {
      mode: 'fixed_duration',
      rental_price_minor: item.rentalPriceMinor,
      security_deposit_minor: item.securityDepositMinor,
      extra_day_price_minor: item.extraDayPriceMinor,
      prep_minutes: 0,
      turnaround_minutes: 180,
      included_days: 3,
    },
    activate: false,
  });
}
