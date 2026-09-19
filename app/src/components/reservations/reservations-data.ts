export type ReservationStatus =
  | "New"
  | "Pending Confirmation"
  | "Confirmed"
  | "Picked Up"
  | "Returned"
  | "Completed"
  | "Cancelled"
  | "Late Return";

export type PaymentStatus = "Paid" | "Pending" | "Failed";

export type ReservationRecord = {
  id: string;
  createdAt: string;
  customer: {
    name: string;
    initials: string;
    phone: string;
    social: string;
    address: string;
  };
  clothing: {
    name: string;
    size: string;
    pricePerDay: string;
    quantity: number;
  };
  rentalPeriod: string;
  duration: string;
  pickup: {
    date: string;
    time: string;
  };
  return: {
    date: string;
    time: string;
  };
  delivery: string;
  payment: {
    status: PaymentStatus;
    total: string;
    detail: string;
  };
  status: ReservationStatus;
  verification: "Completed" | "Pending" | "Not required";
  notes: string;
};

export const RESERVATION_METRICS = [
  { label: "Total Reservations", value: "48", description: "All time", tone: "blue" },
  { label: "Active Rentals", value: "18", description: "Currently rented", tone: "mint" },
  { label: "Upcoming Pickups", value: "6", description: "Today & tomorrow", tone: "gold" },
  { label: "Upcoming Returns", value: "8", description: "Today & tomorrow", tone: "gold" },
  { label: "Needs Attention", value: "5", description: "Action required", tone: "danger" },
] as const;

export const RESERVATION_TABS = [
  { label: "All", count: 48 },
  { label: "New", count: 3 },
  { label: "Pending Confirmation", count: 4 },
  { label: "Confirmed", count: 16 },
  { label: "Picked Up", count: 8 },
  { label: "Returned", count: 12 },
  { label: "Completed", count: 5 },
  { label: "Cancelled", count: 2 },
] as const;

export const RESERVATIONS: readonly ReservationRecord[] = [
  {
    id: "R-00148",
    createdAt: "Sep 10, 2025 · 10:24 AM",
    customer: {
      name: "Maria Santos",
      initials: "MS",
      phone: "+63 912 345 6789",
      social: "@mariasantos",
      address: "123 Maple St., Makati, Metro Manila",
    },
    clothing: { name: "Black Satin Gown", size: "M", pricePerDay: "₱1,500", quantity: 1 },
    rentalPeriod: "Sep 12 – 14",
    duration: "3 days",
    pickup: { date: "Sep 12", time: "10:00 AM" },
    return: { date: "Sep 14", time: "10:00 AM" },
    delivery: "Self pickup",
    payment: { status: "Paid", total: "₱4,500", detail: "Rental + Deposit" },
    status: "Confirmed",
    verification: "Completed",
    notes: "No special requests.",
  },
  {
    id: "R-00147",
    createdAt: "Sep 10, 2025 · 9:42 AM",
    customer: {
      name: "Anna Reyes",
      initials: "AR",
      phone: "+63 917 222 3344",
      social: "@annareyes",
      address: "Pasig City, Metro Manila",
    },
    clothing: { name: "Red Evening Dress", size: "S", pricePerDay: "₱1,200", quantity: 1 },
    rentalPeriod: "Sep 13 – 15",
    duration: "3 days",
    pickup: { date: "Sep 13", time: "11:00 AM" },
    return: { date: "Sep 15", time: "11:00 AM" },
    delivery: "Lalamove",
    payment: { status: "Pending", total: "₱3,600", detail: "Rental + Deposit" },
    status: "Pending Confirmation",
    verification: "Pending",
    notes: "Customer requested delivery confirmation before noon.",
  },
  {
    id: "R-00146",
    createdAt: "Sep 9, 2025 · 4:15 PM",
    customer: {
      name: "Carla Dela Cruz",
      initials: "CD",
      phone: "+63 995 765 4321",
      social: "@carladelacruz",
      address: "Quezon City, Metro Manila",
    },
    clothing: { name: "Wedding Gown", size: "L", pricePerDay: "₱3,500", quantity: 1 },
    rentalPeriod: "Sep 15 – 17",
    duration: "3 days",
    pickup: { date: "Sep 15", time: "10:00 AM" },
    return: { date: "Sep 17", time: "10:00 AM" },
    delivery: "LBC",
    payment: { status: "Paid", total: "₱10,500", detail: "Rental + Deposit" },
    status: "Confirmed",
    verification: "Completed",
    notes: "Handle train and veil carefully during packing.",
  },
  {
    id: "R-00145",
    createdAt: "Sep 9, 2025 · 2:30 PM",
    customer: {
      name: "Jamie Cruz",
      initials: "JC",
      phone: "+63 916 888 1212",
      social: "@jamiecruz",
      address: "Taguig City, Metro Manila",
    },
    clothing: { name: "Debut Gown", size: "M", pricePerDay: "₱2,800", quantity: 1 },
    rentalPeriod: "Sep 16 – 18",
    duration: "3 days",
    pickup: { date: "Sep 16", time: "1:00 PM" },
    return: { date: "Sep 18", time: "1:00 PM" },
    delivery: "Self pickup",
    payment: { status: "Paid", total: "₱8,400", detail: "Rental + Deposit" },
    status: "Picked Up",
    verification: "Completed",
    notes: "Fitting completed before pickup.",
  },
  {
    id: "R-00144",
    createdAt: "Sep 8, 2025 · 5:18 PM",
    customer: {
      name: "Sofia Garcia",
      initials: "SG",
      phone: "+63 905 555 7788",
      social: "@sofiagarcia",
      address: "Mandaluyong City, Metro Manila",
    },
    clothing: { name: "Blue Gown", size: "S", pricePerDay: "₱1,800", quantity: 1 },
    rentalPeriod: "Sep 17 – 19",
    duration: "3 days",
    pickup: { date: "Sep 17", time: "10:00 AM" },
    return: { date: "Sep 19", time: "10:00 AM" },
    delivery: "Lalamove",
    payment: { status: "Paid", total: "₱5,400", detail: "Rental + Deposit" },
    status: "Returned",
    verification: "Completed",
    notes: "Returned in good condition.",
  },
  {
    id: "R-00143",
    createdAt: "Sep 8, 2025 · 12:05 PM",
    customer: {
      name: "Patricia Lim",
      initials: "PL",
      phone: "+63 932 111 2233",
      social: "@patricialim",
      address: "Manila, Metro Manila",
    },
    clothing: { name: "Filipiniana", size: "M", pricePerDay: "₱2,200", quantity: 1 },
    rentalPeriod: "Sep 18 – 20",
    duration: "3 days",
    pickup: { date: "Sep 18", time: "9:00 AM" },
    return: { date: "Sep 20", time: "9:00 AM" },
    delivery: "Self pickup",
    payment: { status: "Paid", total: "₱6,600", detail: "Rental + Deposit" },
    status: "Completed",
    verification: "Completed",
    notes: "Reservation lifecycle completed.",
  },
  {
    id: "R-00142",
    createdAt: "Sep 7, 2025 · 6:40 PM",
    customer: {
      name: "Leanne Cruz",
      initials: "LC",
      phone: "+63 917 444 5566",
      social: "@leannecruz",
      address: "Pasay City, Metro Manila",
    },
    clothing: { name: "White Gown", size: "L", pricePerDay: "₱3,000", quantity: 1 },
    rentalPeriod: "Sep 14 – 16",
    duration: "3 days",
    pickup: { date: "Sep 14", time: "10:00 AM" },
    return: { date: "Sep 16", time: "10:00 AM" },
    delivery: "LBC",
    payment: { status: "Paid", total: "₱9,000", detail: "Rental + Deposit" },
    status: "Late Return",
    verification: "Completed",
    notes: "Return is overdue. Contact customer before applying any charge.",
  },
  {
    id: "R-00141",
    createdAt: "Sep 6, 2025 · 3:20 PM",
    customer: {
      name: "Mika Reyes",
      initials: "MR",
      phone: "+63 906 777 8899",
      social: "@mikareyes",
      address: "Makati City, Metro Manila",
    },
    clothing: { name: "Pink Gown", size: "S", pricePerDay: "₱1,900", quantity: 1 },
    rentalPeriod: "Sep 12 – 14",
    duration: "3 days",
    pickup: { date: "Sep 12", time: "10:00 AM" },
    return: { date: "Sep 14", time: "10:00 AM" },
    delivery: "Self pickup",
    payment: { status: "Failed", total: "₱5,700", detail: "Rental + Deposit" },
    status: "Cancelled",
    verification: "Not required",
    notes: "Reservation cancelled after payment failure.",
  },
];
