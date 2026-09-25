/**
 * V1.1 frontend visualization data only.
 *
 * This module intentionally does not import fitting contracts or production API clients. Its
 * shapes are prototype-only and may change after the fitting workflow is validated with owners.
 */

export const FITTING_PROTOTYPE_ROUTES = {
  appointments: "/fittings",
  schedule: "/fittings/schedule",
} as const;

export type FittingPrototypeStatus =
  | "Pending"
  | "Confirmed"
  | "Completed"
  | "Cancelled"
  | "Rejected"
  | "No-show";

export type FittingPrototypePaymentState = "Not required" | "Pending review" | "Verified";
export type FittingPrototypeResourceKind = "Room" | "Staff" | "Capacity slot";
export type FittingPrototypeAttentionKind =
  | "Payment review"
  | "Resource missing"
  | "Preference only";

export interface FittingPrototypeGarment {
  id: string;
  productName: string;
  variantLabel: string;
  guarantee: "Preference only" | "Guaranteed";
  assetCode?: string;
}

export interface FittingPrototypeResourceAssignment {
  resourceId: string;
  label: string;
  kind: FittingPrototypeResourceKind;
}

export interface FittingPrototypeAppointment {
  id: string;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  startsAt: string;
  endsAt: string;
  status: FittingPrototypeStatus;
  garments: readonly FittingPrototypeGarment[];
  resources: readonly FittingPrototypeResourceAssignment[];
  feeMinor: number | null;
  currency: "PHP";
  paymentState: FittingPrototypePaymentState;
  attention: readonly FittingPrototypeAttentionKind[];
}

export interface FittingPrototypeWorkingWindow {
  weekday: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  startsAt: string;
  endsAt: string;
}

export interface FittingPrototypeClosure {
  id: string;
  startsAt: string;
  endsAt: string;
  label: string;
}

export interface FittingPrototypeResource {
  id: string;
  label: string;
  kind: FittingPrototypeResourceKind;
  active: boolean;
  workingWindows: readonly FittingPrototypeWorkingWindow[];
  closures: readonly FittingPrototypeClosure[];
}

const WEEKDAY_HOURS: readonly FittingPrototypeWorkingWindow[] = [
  { weekday: "Mon", startsAt: "09:00", endsAt: "17:00" },
  { weekday: "Tue", startsAt: "09:00", endsAt: "17:00" },
  { weekday: "Wed", startsAt: "09:00", endsAt: "17:00" },
  { weekday: "Thu", startsAt: "09:00", endsAt: "17:00" },
  { weekday: "Fri", startsAt: "09:00", endsAt: "17:00" },
  { weekday: "Sat", startsAt: "09:00", endsAt: "15:00" },
];

export const FITTING_PROTOTYPE_RESOURCES: readonly FittingPrototypeResource[] = [
  {
    id: "fit-resource-room-01",
    label: "Fitting Room 1",
    kind: "Room",
    active: true,
    workingWindows: WEEKDAY_HOURS,
    closures: [
      {
        id: "fit-closure-room-01-lunch",
        startsAt: "2026-09-26T12:00:00+08:00",
        endsAt: "2026-09-26T13:00:00+08:00",
        label: "Lunch closure",
      },
    ],
  },
  {
    id: "fit-resource-room-02",
    label: "Fitting Room 2",
    kind: "Room",
    active: true,
    workingWindows: WEEKDAY_HOURS,
    closures: [],
  },
  {
    id: "fit-resource-staff-01",
    label: "Fitting Staff A",
    kind: "Staff",
    active: true,
    workingWindows: WEEKDAY_HOURS,
    closures: [],
  },
  {
    id: "fit-resource-slot-01",
    label: "Capacity Slot 1",
    kind: "Capacity slot",
    active: true,
    workingWindows: WEEKDAY_HOURS,
    closures: [],
  },
] as const;

export const FITTING_PROTOTYPE_APPOINTMENTS: readonly FittingPrototypeAppointment[] = [
  {
    id: "fit-proto-001",
    customer: {
      id: "fit-customer-001",
      name: "Ari dela Rosa",
      email: "ari@example.test",
      phone: "0917 000 0001",
    },
    startsAt: "2026-09-26T09:00:00+08:00",
    endsAt: "2026-09-26T10:00:00+08:00",
    status: "Confirmed",
    garments: [
      {
        id: "fit-line-001",
        productName: "Emerald Evening Gown",
        variantLabel: "Medium / Green",
        guarantee: "Guaranteed",
        assetCode: "PROTO-GWN-0042",
      },
    ],
    resources: [
      { resourceId: "fit-resource-room-01", label: "Fitting Room 1", kind: "Room" },
      { resourceId: "fit-resource-staff-01", label: "Fitting Staff A", kind: "Staff" },
    ],
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: [],
  },
  {
    id: "fit-proto-002",
    customer: {
      id: "fit-customer-002",
      name: "Bianca Flores",
      email: "bianca@example.test",
      phone: "0917 000 0002",
    },
    startsAt: "2026-09-26T10:30:00+08:00",
    endsAt: "2026-09-26T11:30:00+08:00",
    status: "Pending",
    garments: [
      {
        id: "fit-line-002",
        productName: "Ivory Wedding Gown",
        variantLabel: "Small / Ivory",
        guarantee: "Preference only",
      },
    ],
    resources: [
      { resourceId: "fit-resource-room-02", label: "Fitting Room 2", kind: "Room" },
    ],
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Pending review",
    attention: ["Payment review", "Preference only"],
  },
  {
    id: "fit-proto-003",
    customer: {
      id: "fit-customer-003",
      name: "Celine Navarro",
      email: "celine@example.test",
      phone: "0917 000 0003",
    },
    startsAt: "2026-09-26T13:00:00+08:00",
    endsAt: "2026-09-26T14:00:00+08:00",
    status: "Confirmed",
    garments: [
      {
        id: "fit-line-003",
        productName: "Modern Filipiniana",
        variantLabel: "Medium / Cream",
        guarantee: "Preference only",
      },
      {
        id: "fit-line-004",
        productName: "Butterfly Sleeve Set",
        variantLabel: "Standard / Cream",
        guarantee: "Preference only",
      },
    ],
    resources: [
      { resourceId: "fit-resource-staff-01", label: "Fitting Staff A", kind: "Staff" },
    ],
    feeMinor: null,
    currency: "PHP",
    paymentState: "Not required",
    attention: ["Preference only"],
  },
  {
    id: "fit-proto-004",
    customer: {
      id: "fit-customer-004",
      name: "Dana Mercado",
      email: "dana@example.test",
      phone: "0917 000 0004",
    },
    startsAt: "2026-09-27T09:30:00+08:00",
    endsAt: "2026-09-27T10:30:00+08:00",
    status: "Pending",
    garments: [
      {
        id: "fit-line-005",
        productName: "Champagne Ball Gown",
        variantLabel: "Large / Champagne",
        guarantee: "Guaranteed",
        assetCode: "PROTO-GWN-0088",
      },
    ],
    resources: [],
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: ["Resource missing"],
  },
  {
    id: "fit-proto-005",
    customer: {
      id: "fit-customer-005",
      name: "Elise Villanueva",
      email: "elise@example.test",
      phone: "0917 000 0005",
    },
    startsAt: "2026-09-25T14:00:00+08:00",
    endsAt: "2026-09-25T15:00:00+08:00",
    status: "Completed",
    garments: [
      {
        id: "fit-line-006",
        productName: "Classic Barong",
        variantLabel: "Large / Ecru",
        guarantee: "Guaranteed",
        assetCode: "PROTO-BRG-0013",
      },
    ],
    resources: [
      { resourceId: "fit-resource-room-01", label: "Fitting Room 1", kind: "Room" },
      { resourceId: "fit-resource-staff-01", label: "Fitting Staff A", kind: "Staff" },
    ],
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: [],
  },
  {
    id: "fit-proto-006",
    customer: {
      id: "fit-customer-006",
      name: "Faye Mendoza",
      email: "faye@example.test",
      phone: "0917 000 0006",
    },
    startsAt: "2026-09-24T15:30:00+08:00",
    endsAt: "2026-09-24T16:30:00+08:00",
    status: "No-show",
    garments: [
      {
        id: "fit-line-007",
        productName: "Rose Evening Dress",
        variantLabel: "Medium / Rose",
        guarantee: "Preference only",
      },
    ],
    resources: [
      { resourceId: "fit-resource-room-02", label: "Fitting Room 2", kind: "Room" },
    ],
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: ["Preference only"],
  },
] as const;
