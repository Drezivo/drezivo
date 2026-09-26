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

export const FITTING_PROTOTYPE_TODAY = "2026-09-26";

export type FittingPrototypeStatus =
  "Pending" | "Confirmed" | "Completed" | "Cancelled" | "Rejected" | "No-show";

export type FittingPrototypePaymentState = "Not required" | "Pending review" | "Verified";
export type FittingPrototypeAttentionKind = "Payment review" | "Preference only";

export interface FittingPrototypeGarment {
  id: string;
  productName: string;
  variantLabel: string;
  guarantee: "Preference only" | "Guaranteed" | "Guaranteed intent";
  assetCode?: string;
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
  feeMinor: number | null;
  currency: "PHP";
  paymentState: FittingPrototypePaymentState;
  attention: readonly FittingPrototypeAttentionKind[];
}

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
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: [],
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
    feeMinor: 30000,
    currency: "PHP",
    paymentState: "Verified",
    attention: ["Preference only"],
  },
  ...Array.from({ length: 14 }, (_, index): FittingPrototypeAppointment => {
    const names = [
      "Gina Reyes",
      "Hazel Lim",
      "Ivy Santos",
      "Jessa Cruz",
      "Kara Bautista",
      "Lia Ramos",
      "Mika Torres",
      "Nina Gomez",
      "Olivia Tan",
      "Paula Garcia",
      "Queenie Lopez",
      "Rina Castillo",
      "Sofia Velasco",
      "Tina Aquino",
    ] as const;
    const garments = [
      ["Sage Bridesmaid Dress", "Medium / Sage"],
      ["Navy Formal Gown", "Large / Navy"],
      ["Pearl Filipiniana", "Small / Pearl"],
      ["Black Cocktail Dress", "Medium / Black"],
      ["Traditional Barong", "Medium / Ecru"],
      ["Blush Debut Gown", "Small / Blush"],
      ["Royal Blue Ball Gown", "Large / Royal Blue"],
    ] as const;
    const statuses: readonly FittingPrototypeStatus[] = [
      "Pending",
      "Confirmed",
      "Confirmed",
      "Pending",
      "Completed",
      "Confirmed",
      "Pending",
      "Confirmed",
      "Completed",
      "Pending",
      "Confirmed",
      "Cancelled",
      "Pending",
      "Confirmed",
    ];
    const name = names[index]!;
    const [productName, variantLabel] = garments[index % garments.length]!;
    const day = 27 + Math.floor(index / 3);
    const datePart =
      day <= 30
        ? `2026-09-${String(day).padStart(2, "0")}`
        : `2026-10-${String(day - 30).padStart(2, "0")}`;
    const hour = 9 + (index % 3) * 2;
    const paymentState: FittingPrototypePaymentState =
      index % 4 === 0 ? "Pending review" : index % 5 === 0 ? "Not required" : "Verified";

    return {
      id: `fit-proto-${String(index + 7).padStart(3, "0")}`,
      customer: {
        id: `fit-customer-${String(index + 7).padStart(3, "0")}`,
        name,
        email: `${name.toLocaleLowerCase().replace(/\s+/g, ".")}@example.test`,
        phone: `0917 000 ${String(index + 7).padStart(4, "0")}`,
      },
      startsAt: `${datePart}T${String(hour).padStart(2, "0")}:00:00+08:00`,
      endsAt: `${datePart}T${String(hour + 1).padStart(2, "0")}:00:00+08:00`,
      status: statuses[index]!,
      garments: [
        {
          id: `fit-line-${String(index + 8).padStart(3, "0")}`,
          productName,
          variantLabel,
          guarantee: "Preference only",
        },
      ],
      feeMinor: index % 5 === 0 ? null : 30000,
      currency: "PHP",
      paymentState,
      attention: [
        ...(paymentState === "Pending review" ? (["Payment review"] as const) : []),
        "Preference only",
      ],
    };
  }),
] as const;
