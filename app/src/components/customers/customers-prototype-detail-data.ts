import type {
  CustomerActivityPrototype,
  CustomerListItemPrototype,
} from "./customers-prototype-data";
import { CUSTOMER_LIST_PROTOTYPE } from "./customers-prototype-data";

export interface CustomerReservationHistoryPrototype {
  id: string;
  reference: string;
  clothing_name: string;
  pickup_at: string;
  return_at: string;
  status: "confirmed" | "completed" | "cancelled";
  rental_amount: string;
  currency: "PHP";
}

export interface CustomerFittingHistoryPrototype {
  id: string;
  starts_at: string;
  status: "confirmed" | "completed" | "cancelled" | "no_show";
  garment_summary: string | null;
  fee_amount: string;
  currency: "PHP";
  payment_status: "paid" | "pending";
}

export interface CustomerDetailPrototype extends CustomerListItemPrototype {
  address: string | null;
  social_media: string | null;
  notes: string | null;
  completed_engagement_count: number;
  reservation_history: readonly CustomerReservationHistoryPrototype[];
  fitting_history: readonly CustomerFittingHistoryPrototype[];
}

const MARIA_RESERVATIONS: readonly CustomerReservationHistoryPrototype[] = [
  {
    id: "reservation-prototype-001",
    reference: "RSV-260924-018",
    clothing_name: "Emerald Filipiniana Gown",
    pickup_at: "2026-09-21T02:00:00.000Z",
    return_at: "2026-09-24T06:00:00.000Z",
    status: "completed",
    rental_amount: "3500.00",
    currency: "PHP",
  },
  {
    id: "reservation-prototype-002",
    reference: "RSV-260817-011",
    clothing_name: "Champagne Formal Gown",
    pickup_at: "2026-08-14T03:00:00.000Z",
    return_at: "2026-08-17T05:00:00.000Z",
    status: "completed",
    rental_amount: "3200.00",
    currency: "PHP",
  },
  {
    id: "reservation-prototype-003",
    reference: "RSV-260702-004",
    clothing_name: "Ivory Modern Filipiniana",
    pickup_at: "2026-06-29T02:30:00.000Z",
    return_at: "2026-07-02T04:30:00.000Z",
    status: "completed",
    rental_amount: "2800.00",
    currency: "PHP",
  },
  {
    id: "reservation-prototype-004",
    reference: "RSV-260315-002",
    clothing_name: "Sage Evening Dress",
    pickup_at: "2026-03-12T02:00:00.000Z",
    return_at: "2026-03-15T03:00:00.000Z",
    status: "completed",
    rental_amount: "2400.00",
    currency: "PHP",
  },
];

const MARIA_FITTINGS: readonly CustomerFittingHistoryPrototype[] = [
  {
    id: "fitting-prototype-001",
    starts_at: "2026-10-03T05:00:00.000Z",
    status: "confirmed",
    garment_summary: "Emerald Filipiniana Gown · Size S",
    fee_amount: "200.00",
    currency: "PHP",
    payment_status: "pending",
  },
  {
    id: "fitting-prototype-002",
    starts_at: "2026-09-18T06:00:00.000Z",
    status: "completed",
    garment_summary: "Champagne Formal Gown · Size S",
    fee_amount: "200.00",
    currency: "PHP",
    payment_status: "paid",
  },
];

export const CUSTOMER_DETAIL_PROTOTYPES: readonly CustomerDetailPrototype[] =
  CUSTOMER_LIST_PROTOTYPE.map((customer, index) => ({
    ...customer,
    address:
      index === 0
        ? "24 Sampaguita Street, Quezon City, Metro Manila"
        : index % 3 === 0
          ? null
          : `${100 + index} Mabini Street, Quezon City, Metro Manila`,
    social_media: index === 0 ? "@maria.santos" : `@${customer.full_name.toLowerCase().replace(/\s+/g, ".")}`,
    notes:
      index === 0
        ? "Prefers afternoon pickup. Confirm garment measurements before final handover."
        : null,
    completed_engagement_count: customer.reservation_count + Math.max(0, customer.fitting_count - 1),
    reservation_history:
      index === 0
        ? MARIA_RESERVATIONS
        : customer.reservation_count > 0
          ? [
              {
                id: `reservation-${customer.id}`,
                reference: `RSV-26${String(index + 1).padStart(4, "0")}`,
                clothing_name: "Formal Rental Garment",
                pickup_at: customer.last_activity?.at ?? customer.created_at,
                return_at: customer.last_activity?.at ?? customer.created_at,
                status: "completed" as const,
                rental_amount: "2500.00",
                currency: "PHP" as const,
              },
            ]
          : [],
    fitting_history:
      index === 0
        ? MARIA_FITTINGS
        : customer.fitting_count > 0
          ? [
              {
                id: `fitting-${customer.id}`,
                starts_at: customer.next_activity?.at ?? customer.last_activity?.at ?? customer.created_at,
                status: customer.next_activity?.type === "fitting" ? ("confirmed" as const) : ("completed" as const),
                garment_summary: "Rental fitting",
                fee_amount: "200.00",
                currency: "PHP" as const,
                payment_status: "paid" as const,
              },
            ]
          : [],
  }));

export function getCustomerDetailPrototype(customerId: string): CustomerDetailPrototype | null {
  return CUSTOMER_DETAIL_PROTOTYPES.find((customer) => customer.id === customerId) ?? null;
}

export function updateCustomerDetailPrototype(
  customerId: string,
  input: Pick<CustomerDetailPrototype, "full_name" | "phone" | "email" | "address" | "social_media" | "notes">
): CustomerDetailPrototype | null {
  const customer = getCustomerDetailPrototype(customerId);
  return customer ? { ...customer, ...input } : null;
}

export function activityLabel(activity: CustomerActivityPrototype | null): string {
  return activity ? `${activity.type} · ${activity.at}` : "None";
}
