export type ClothingItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  sizes: string[];
  variantCount: number;
  minPricePerDay: number;
  maxPricePerDay: number;
  physicalUnits: number;
  archived: boolean;
  initials: string;
};

const BASE_ITEMS: ClothingItem[] = [
  {
    id: "CG-001",
    code: "#CG-001",
    name: "Black Satin Gown",
    category: "Evening Gown",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1500,
    maxPricePerDay: 1500,
    physicalUnits: 4,
    archived: false,
    initials: "BS",
  },
  {
    id: "CG-002",
    code: "#CG-002",
    name: "Red Evening Dress",
    category: "Evening Gown",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1200,
    maxPricePerDay: 1400,
    physicalUnits: 5,
    archived: false,
    initials: "RE",
  },
  {
    id: "CG-003",
    code: "#CG-003",
    name: "White Wedding Gown",
    category: "Wedding Gown",
    sizes: ["XS", "S", "M", "L"],
    variantCount: 4,
    minPricePerDay: 3000,
    maxPricePerDay: 3500,
    physicalUnits: 6,
    archived: false,
    initials: "WW",
  },
  {
    id: "CG-004",
    code: "#CG-004",
    name: "Blue Bridesmaid Dress",
    category: "Bridesmaid Dress",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1200,
    maxPricePerDay: 1200,
    physicalUnits: 7,
    archived: false,
    initials: "BB",
  },
  {
    id: "CG-005",
    code: "#CG-005",
    name: "Pink Gown",
    category: "Debut Gown",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 2500,
    maxPricePerDay: 2800,
    physicalUnits: 4,
    archived: false,
    initials: "PG",
  },
  {
    id: "CG-006",
    code: "#CG-006",
    name: "Filipiniana Dress",
    category: "Filipiniana",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 2000,
    maxPricePerDay: 2200,
    physicalUnits: 5,
    archived: false,
    initials: "FD",
  },
  {
    id: "CG-007",
    code: "#CG-007",
    name: "Lavender Dress",
    category: "Evening Gown",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1800,
    maxPricePerDay: 1800,
    physicalUnits: 3,
    archived: false,
    initials: "LD",
  },
  {
    id: "CG-008",
    code: "#CG-008",
    name: "Men's Barong Tagalog",
    category: "Barong",
    sizes: ["S", "M", "L", "XL"],
    variantCount: 4,
    minPricePerDay: 1000,
    maxPricePerDay: 1300,
    physicalUnits: 8,
    archived: false,
    initials: "BT",
  },
  {
    id: "CG-009",
    code: "#CG-009",
    name: "Black Costume",
    category: "Costume",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1200,
    maxPricePerDay: 1200,
    physicalUnits: 3,
    archived: false,
    initials: "BC",
  },
  {
    id: "CG-010",
    code: "#CG-010",
    name: "Beige Gown",
    category: "Evening Gown",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1500,
    maxPricePerDay: 1700,
    physicalUnits: 4,
    archived: false,
    initials: "BG",
  },
  {
    id: "CG-011",
    code: "#CG-011",
    name: "Emerald Formal Dress",
    category: "Formal Wear",
    sizes: ["S", "M", "L"],
    variantCount: 3,
    minPricePerDay: 1700,
    maxPricePerDay: 1900,
    physicalUnits: 5,
    archived: false,
    initials: "EF",
  },
  {
    id: "CG-012",
    code: "#CG-012",
    name: "Classic Black Suit",
    category: "Formal Wear",
    sizes: ["M", "L", "XL"],
    variantCount: 3,
    minPricePerDay: 1400,
    maxPricePerDay: 1600,
    physicalUnits: 6,
    archived: false,
    initials: "CS",
  },
];

export const CLOTHING_ITEMS: ClothingItem[] = Array.from({ length: 48 }, (_, index) => {
  const source = BASE_ITEMS[index % BASE_ITEMS.length]!;
  const cycle = Math.floor(index / BASE_ITEMS.length) + 1;
  const number = String(index + 1).padStart(3, "0");

  return {
    ...source,
    id: `CG-${number}`,
    code: `#CG-${number}`,
    name: cycle === 1 ? source.name : `${source.name} ${cycle}`,
    physicalUnits: source.variantCount,
    archived: (index + 1) % 16 === 0,
  };
});

export const CLOTHING_CATEGORIES = [
  "All Categories",
  ...Array.from(new Set(CLOTHING_ITEMS.map((item) => item.category))).sort(),
] as const;

export const CLOTHING_SIZES = ["All Sizes", "XS", "S", "M", "L", "XL"] as const;
