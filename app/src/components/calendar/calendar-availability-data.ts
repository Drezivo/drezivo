export type AvailabilityState =
  | "Reserved"
  | "Rented"
  | "Pickup"
  | "Return"
  | "Fitting"
  | "Unavailable"
  | "Cleaning"
  | "Maintenance"
  | "Available";

export type AvailabilityBlock = {
  state: AvailabilityState;
  start: number;
  span: number;
  customer?: string;
  note?: string;
};

export type AvailabilityItem = {
  id: string;
  name: string;
  code: string;
  size: string;
  pricePerDay: string;
  category: string;
  initials: string;
  blocks: AvailabilityBlock[];
  upcoming: { customer: string; date: string; state: AvailabilityState }[];
};

export const AVAILABILITY_DAYS = [
  { label: "Mon", date: "Sep 8" },
  { label: "Tue", date: "Sep 9" },
  { label: "Wed", date: "Sep 10" },
  { label: "Thu", date: "Sep 11" },
  { label: "Fri", date: "Sep 12" },
  { label: "Sat", date: "Sep 13" },
  { label: "Sun", date: "Sep 14" },
  { label: "Mon", date: "Sep 15" },
  { label: "Tue", date: "Sep 16" },
  { label: "Wed", date: "Sep 17" },
  { label: "Thu", date: "Sep 18" },
  { label: "Fri", date: "Sep 19" },
  { label: "Sat", date: "Sep 20" },
  { label: "Sun", date: "Sep 21" },
] as const;

const BASE_AVAILABILITY_ITEMS: AvailabilityItem[] = [
  {
    id: "CG-001",
    name: "Black Satin Gown",
    code: "#CG-001",
    size: "S",
    pricePerDay: "₱1,500/day",
    category: "Gowns",
    initials: "BS",
    blocks: [
      { state: "Reserved", start: 1, span: 4, customer: "Maria Santos", note: "Sep 8 – 11" },
      { state: "Rented", start: 5, span: 4, customer: "Carla Dela Cruz", note: "Sep 12 – 14" },
      { state: "Cleaning", start: 9, span: 2, note: "Sep 15" },
    ],
    upcoming: [
      { customer: "Carla Dela Cruz", date: "Sep 12 – 14", state: "Rented" },
      { customer: "Maria Santos", date: "Sep 8 – 11", state: "Reserved" },
      { customer: "Leanne Cruz", date: "Sep 17", state: "Fitting" },
    ],
  },
  {
    id: "CG-002",
    name: "Red Evening Dress",
    code: "#CG-002",
    size: "M",
    pricePerDay: "₱1,200/day",
    category: "Dresses",
    initials: "RE",
    blocks: [
      { state: "Pickup", start: 2, span: 2, customer: "Anna Reyes", note: "Sep 9 · 10:30 AM" },
      { state: "Rented", start: 6, span: 4, customer: "Sofia Garcia", note: "Sep 13 – 16" },
      { state: "Fitting", start: 10, span: 3, customer: "Leanne Cruz", note: "Sep 17 · 11:00 AM" },
    ],
    upcoming: [
      { customer: "Sofia Garcia", date: "Sep 13 – 16", state: "Rented" },
      { customer: "Leanne Cruz", date: "Sep 17", state: "Fitting" },
    ],
  },
  {
    id: "CG-003",
    name: "White Wedding Gown",
    code: "#CG-003",
    size: "S",
    pricePerDay: "₱3,000/day",
    category: "Wedding",
    initials: "WW",
    blocks: [
      { state: "Unavailable", start: 1, span: 3, note: "Sep 8 – 10" },
      { state: "Reserved", start: 4, span: 3, customer: "Patricia Lim", note: "Sep 11 – 13" },
      { state: "Pickup", start: 11, span: 3, customer: "Mika Reyes", note: "Sep 18 · 2:00 PM" },
    ],
    upcoming: [
      { customer: "Patricia Lim", date: "Sep 11 – 13", state: "Reserved" },
      { customer: "Mika Reyes", date: "Sep 18", state: "Pickup" },
    ],
  },
  {
    id: "CG-004",
    name: "Blue Bridesmaid Dress",
    code: "#CG-004",
    size: "M",
    pricePerDay: "₱1,200/day",
    category: "Dresses",
    initials: "BB",
    blocks: [
      { state: "Reserved", start: 3, span: 3, customer: "Jamie Cruz", note: "Sep 10 – 12" },
      { state: "Rented", start: 7, span: 4, customer: "Bea Cruz", note: "Sep 14 – 17" },
      { state: "Return", start: 12, span: 2, customer: "Karen Lim", note: "Sep 19" },
    ],
    upcoming: [
      { customer: "Jamie Cruz", date: "Sep 10 – 12", state: "Reserved" },
      { customer: "Bea Cruz", date: "Sep 14 – 17", state: "Rented" },
    ],
  },
  {
    id: "CG-005",
    name: "Filipiniana Dress",
    code: "#CG-005",
    size: "S",
    pricePerDay: "₱2,000/day",
    category: "Filipiniana",
    initials: "FD",
    blocks: [
      { state: "Rented", start: 2, span: 4, customer: "Trisha Garcia", note: "Sep 9 – 11" },
      { state: "Maintenance", start: 6, span: 2, note: "Sep 12 – 13" },
      { state: "Reserved", start: 9, span: 4, customer: "Alyssa Santos", note: "Sep 16 – 19" },
    ],
    upcoming: [
      { customer: "Alyssa Santos", date: "Sep 16 – 19", state: "Reserved" },
      { customer: "Trisha Garcia", date: "Sep 9 – 11", state: "Rented" },
    ],
  },
  {
    id: "CG-006",
    name: "Pink Gown",
    code: "#CG-006",
    size: "L",
    pricePerDay: "₱1,500/day",
    category: "Gowns",
    initials: "PG",
    blocks: [
      { state: "Fitting", start: 3, span: 3, customer: "Sophia Garcia", note: "Sep 10 · 1:00 PM" },
      { state: "Rented", start: 7, span: 3, customer: "Leanne Cruz", note: "Sep 14 – 16" },
      { state: "Pickup", start: 13, span: 2, customer: "Carmen Lopez", note: "Sep 20 · 11:00 AM" },
    ],
    upcoming: [
      { customer: "Leanne Cruz", date: "Sep 14 – 16", state: "Rented" },
      { customer: "Sophia Garcia", date: "Sep 10", state: "Fitting" },
    ],
  },
  {
    id: "CG-007",
    name: "Barong Tagalog",
    code: "#CG-007",
    size: "M",
    pricePerDay: "₱1,000/day",
    category: "Barong",
    initials: "BT",
    blocks: [
      { state: "Reserved", start: 5, span: 3, customer: "Daniel Reyes", note: "Sep 11 – 13" },
      { state: "Rented", start: 8, span: 4, customer: "Roy Santos", note: "Sep 15 – 18" },
    ],
    upcoming: [
      { customer: "Roy Santos", date: "Sep 15 – 18", state: "Rented" },
      { customer: "Daniel Reyes", date: "Sep 11 – 13", state: "Reserved" },
    ],
  },
  {
    id: "CG-008",
    name: "Green Evening Dress",
    code: "#CG-008",
    size: "M",
    pricePerDay: "₱1,200/day",
    category: "Dresses",
    initials: "GE",
    blocks: [
      { state: "Unavailable", start: 1, span: 3, note: "Sep 8 – 9" },
      { state: "Reserved", start: 5, span: 4, customer: "Katrina Lim", note: "Sep 12 – 14" },
      { state: "Fitting", start: 10, span: 4, customer: "Janelle Cruz", note: "Sep 17 · 10:00 AM" },
    ],
    upcoming: [
      { customer: "Katrina Lim", date: "Sep 12 – 14", state: "Reserved" },
      { customer: "Janelle Cruz", date: "Sep 17", state: "Fitting" },
    ],
  },
];

/**
 * Development-scale calendar data. Keep the first eight records unchanged for predictable UI
 * references, then repeat them with unique IDs/codes so pagination and scrolling can be tested
 * against a realistically dense rental catalogue. Every tenth generated record intentionally has
 * no agenda in this range; the default calendar omits those rows, while search can still surface
 * them as available.
 */
export const AVAILABILITY_ITEMS: AvailabilityItem[] = Array.from({ length: 80 }, (_, index) => {
  const source = BASE_AVAILABILITY_ITEMS[index % BASE_AVAILABILITY_ITEMS.length]!;
  const cycle = Math.floor(index / BASE_AVAILABILITY_ITEMS.length) + 1;
  const hasAgenda = (index + 1) % 10 !== 0;
  const suffix = cycle === 1 ? "" : ` ${cycle}`;
  const generatedNumber = String(index + 1).padStart(3, "0");

  return {
    ...source,
    id: `CG-${generatedNumber}`,
    code: `#CG-${generatedNumber}`,
    name: `${source.name}${suffix}`,
    blocks: hasAgenda ? source.blocks.map((block) => ({ ...block })) : [],
    upcoming: hasAgenda ? source.upcoming.map((reservation) => ({ ...reservation })) : [],
  };
});
