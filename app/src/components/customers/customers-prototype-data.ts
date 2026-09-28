export interface CustomerDashboardSummaryPrototype {
  all_customers: number;
  new_this_month: number;
  returning_customers: number;
  upcoming_customers: number;
}

export type CustomerProfileStatusPrototype = "active" | "archived";
export type CustomerListStatusFilterPrototype = CustomerProfileStatusPrototype | "all";
export type CustomerActivityKindPrototype = "reservation" | "fitting";

export interface CustomerActivityPrototype {
  type: CustomerActivityKindPrototype;
  at: string;
}

export interface CustomerListItemPrototype {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
  status: CustomerProfileStatusPrototype;
  reservation_count: number;
  fitting_count: number;
  last_activity: CustomerActivityPrototype | null;
  next_activity: CustomerActivityPrototype | null;
}

export interface CustomerListPagePrototype {
  items: readonly CustomerListItemPrototype[];
  page_meta: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export const CUSTOMER_DASHBOARD_SUMMARY_PROTOTYPE: CustomerDashboardSummaryPrototype = {
  all_customers: 128,
  new_this_month: 14,
  returning_customers: 42,
  upcoming_customers: 19,
};

export const CUSTOMER_LIST_PROTOTYPE: readonly CustomerListItemPrototype[] = [
  {
    id: "customer-prototype-001",
    full_name: "Maria Santos",
    phone: "0917 555 0101",
    email: "maria.santos@example.test",
    created_at: "2026-01-18T02:15:00.000Z",
    status: "active",
    reservation_count: 4,
    fitting_count: 2,
    last_activity: { type: "reservation", at: "2026-09-24T06:00:00.000Z" },
    next_activity: { type: "fitting", at: "2026-10-03T05:00:00.000Z" },
  },
  {
    id: "customer-prototype-002",
    full_name: "Anna Reyes",
    phone: "0918 555 0102",
    email: "anna.reyes@example.test",
    created_at: "2026-02-07T03:30:00.000Z",
    status: "active",
    reservation_count: 3,
    fitting_count: 1,
    last_activity: { type: "fitting", at: "2026-09-20T07:30:00.000Z" },
    next_activity: { type: "reservation", at: "2026-10-05T02:00:00.000Z" },
  },
  {
    id: "customer-prototype-003",
    full_name: "Carla Dela Cruz",
    phone: "0919 555 0103",
    email: "carla.delacruz@example.test",
    created_at: "2026-03-12T01:45:00.000Z",
    status: "active",
    reservation_count: 5,
    fitting_count: 3,
    last_activity: { type: "reservation", at: "2026-09-18T04:00:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-004",
    full_name: "Jamie Cruz",
    phone: "0920 555 0104",
    email: "jamie.cruz@example.test",
    created_at: "2026-04-01T04:10:00.000Z",
    status: "active",
    reservation_count: 2,
    fitting_count: 2,
    last_activity: { type: "fitting", at: "2026-09-16T08:00:00.000Z" },
    next_activity: { type: "fitting", at: "2026-10-08T07:00:00.000Z" },
  },
  {
    id: "customer-prototype-005",
    full_name: "Patricia Lim",
    phone: "0921 555 0105",
    email: "patricia.lim@example.test",
    created_at: "2026-04-22T02:20:00.000Z",
    status: "active",
    reservation_count: 6,
    fitting_count: 1,
    last_activity: { type: "reservation", at: "2026-09-14T03:30:00.000Z" },
    next_activity: { type: "reservation", at: "2026-10-12T06:00:00.000Z" },
  },
  {
    id: "customer-prototype-006",
    full_name: "Sophia Garcia",
    phone: "0922 555 0106",
    email: "sophia.garcia@example.test",
    created_at: "2026-05-09T05:00:00.000Z",
    status: "active",
    reservation_count: 1,
    fitting_count: 2,
    last_activity: { type: "fitting", at: "2026-09-12T05:00:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-007",
    full_name: "Alyssa Santos",
    phone: "0923 555 0107",
    email: "alyssa.santos@example.test",
    created_at: "2026-06-03T02:00:00.000Z",
    status: "active",
    reservation_count: 3,
    fitting_count: 3,
    last_activity: { type: "reservation", at: "2026-09-10T02:00:00.000Z" },
    next_activity: { type: "fitting", at: "2026-10-15T04:30:00.000Z" },
  },
  {
    id: "customer-prototype-008",
    full_name: "Bea Cruz",
    phone: "0924 555 0108",
    email: "bea.cruz@example.test",
    created_at: "2026-06-19T03:10:00.000Z",
    status: "active",
    reservation_count: 2,
    fitting_count: 0,
    last_activity: { type: "reservation", at: "2026-09-08T06:30:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-009",
    full_name: "Karen Lim",
    phone: "0925 555 0109",
    email: "karen.lim@example.test",
    created_at: "2026-07-04T01:30:00.000Z",
    status: "active",
    reservation_count: 4,
    fitting_count: 2,
    last_activity: { type: "fitting", at: "2026-09-06T05:30:00.000Z" },
    next_activity: { type: "reservation", at: "2026-10-18T03:00:00.000Z" },
  },
  {
    id: "customer-prototype-010",
    full_name: "Mika Reyes",
    phone: "0926 555 0110",
    email: "mika.reyes@example.test",
    created_at: "2026-07-25T02:45:00.000Z",
    status: "active",
    reservation_count: 1,
    fitting_count: 1,
    last_activity: { type: "reservation", at: "2026-09-04T02:30:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-011",
    full_name: "Trisha Garcia",
    phone: "0927 555 0111",
    email: "trisha.garcia@example.test",
    created_at: "2026-08-02T04:00:00.000Z",
    status: "active",
    reservation_count: 2,
    fitting_count: 1,
    last_activity: { type: "fitting", at: "2026-09-02T07:00:00.000Z" },
    next_activity: { type: "fitting", at: "2026-10-20T05:00:00.000Z" },
  },
  {
    id: "customer-prototype-012",
    full_name: "Nicole Mendoza",
    phone: "0928 555 0112",
    email: "nicole.mendoza@example.test",
    created_at: "2026-08-16T03:15:00.000Z",
    status: "active",
    reservation_count: 3,
    fitting_count: 2,
    last_activity: { type: "reservation", at: "2026-08-30T04:00:00.000Z" },
    next_activity: { type: "reservation", at: "2026-10-22T04:00:00.000Z" },
  },
  {
    id: "customer-prototype-013",
    full_name: "Ella Navarro",
    phone: "0929 555 0113",
    email: "ella.navarro@example.test",
    created_at: "2026-09-05T02:10:00.000Z",
    status: "active",
    reservation_count: 1,
    fitting_count: 1,
    last_activity: { type: "fitting", at: "2026-09-26T06:00:00.000Z" },
    next_activity: { type: "reservation", at: "2026-10-25T02:00:00.000Z" },
  },
  {
    id: "customer-prototype-014",
    full_name: "Rica Flores",
    phone: "0930 555 0114",
    email: "rica.flores@example.test",
    created_at: "2026-09-14T01:50:00.000Z",
    status: "active",
    reservation_count: 1,
    fitting_count: 0,
    last_activity: { type: "reservation", at: "2026-09-27T03:00:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-015",
    full_name: "Diana Ramos",
    phone: "0931 555 0115",
    email: "diana.ramos@example.test",
    created_at: "2026-02-18T02:15:00.000Z",
    status: "archived",
    reservation_count: 2,
    fitting_count: 1,
    last_activity: { type: "reservation", at: "2026-06-12T04:00:00.000Z" },
    next_activity: null,
  },
  {
    id: "customer-prototype-016",
    full_name: "Leah Tan",
    phone: "0932 555 0116",
    email: "leah.tan@example.test",
    created_at: "2026-03-11T02:45:00.000Z",
    status: "archived",
    reservation_count: 3,
    fitting_count: 2,
    last_activity: { type: "fitting", at: "2026-07-20T03:30:00.000Z" },
    next_activity: null,
  },
];

export function getCustomerListPrototypePage(input: {
  cursor: string | null;
  limit: number;
  search: string;
  status: CustomerListStatusFilterPrototype;
}): CustomerListPagePrototype {
  const normalizedSearch = input.search.trim().toLocaleLowerCase();
  const filtered = CUSTOMER_LIST_PROTOTYPE.filter((customer) => {
    const statusMatches = input.status === "all" || customer.status === input.status;
    if (!statusMatches) return false;
    if (!normalizedSearch) return true;

    return [customer.full_name, customer.phone ?? "", customer.email ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch)
    );
  });

  const start = decodePrototypeCursor(input.cursor);
  const items = filtered.slice(start, start + input.limit);
  const nextOffset = start + items.length;
  const hasMore = nextOffset < filtered.length;

  return {
    items,
    page_meta: {
      next_cursor: hasMore ? `customer-prototype:${nextOffset}` : null,
      has_more: hasMore,
    },
  };
}

function decodePrototypeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const match = /^customer-prototype:(\d+)$/.exec(cursor);
  if (!match) return 0;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}
