export interface MarketingPlan {
  readonly name: string;
  readonly price: string;
  readonly blurb: string;
  readonly features: readonly string[];
  readonly highlighted?: boolean;
}

export interface MarketingFaq {
  readonly question: string;
  readonly answer: string;
}

export const MARKETING_PROBLEMS = [
  {
    title: 'Scattered inquiries',
    body: 'Customers message through Instagram, Facebook, or Messenger while your team keeps track manually.',
  },
  {
    title: 'Manual tracking',
    body: 'Spreadsheets and notes for reservations, inventory, and customer details are slow and error-prone.',
  },
  {
    title: 'Scheduling conflicts',
    body: 'It is hard to know whether an item is available, rented, or being cleaned, leading to double bookings.',
  },
  {
    title: 'Payment hassles',
    body: 'Screenshots and cash payments make it difficult to confirm and track transactions properly.',
  },
  {
    title: 'Lost opportunities',
    body: 'Without an online storefront, potential customers cannot browse and book with confidence.',
  },
] as const;

export const MARKETING_FEATURES = [
  {
    label: 'Availability',
    title: 'Know what is ready to rent',
    body: 'See availability by date and keep holds, cleaning, and active reservations visible to the team.',
  },
  {
    label: 'Reservations',
    title: 'Keep every booking in one calendar',
    body: 'Review guest requests, confirm the details, and move each rental from pickup to return.',
  },
  {
    label: 'Payments',
    title: 'Review payment evidence clearly',
    body: 'Accept GCash, Maya, or cash and keep merchant review attached to the reservation record.',
  },
  {
    label: 'Customers',
    title: 'Build a useful customer record',
    body: 'Keep contact details, reservation history, notes, and consent together without a separate spreadsheet.',
  },
  {
    label: 'Storefront',
    title: 'Give guests a simple way to book',
    body: 'Publish a focused catalog where guests can browse, choose dates, and submit a reservation without an account.',
  },
  {
    label: 'Support',
    title: 'Make the next action obvious',
    body: 'Use clear statuses, private guest links, and exports so the team always knows what needs attention.',
  },
] as const;

/** Free trial length; keep in step with the API's billing constants. */
export const MARKETING_TRIAL_DAYS = 14;

/**
 * One plan during the pilot (internal code `starter`, sold as Standard). The API owns the real price,
 * limits, and trial length; keep this copy in step with the current billing policy / migrations.
 */
export const MARKETING_PLANS: readonly MarketingPlan[] = [
  {
    name: 'Standard',
    price: '299.00',
    blurb: 'Everything you need to run your rental shop, with a 14-day free trial.',
    features: [
      'Up to 300 active garments',
      'Up to 3 Front Desk staff',
      'Online storefront with bookings and fittings',
      'Reservations, calendar & availability',
      'Customers, payments, returns & exports',
    ],
    highlighted: true,
  },
];

export interface MarketingFaqGroup {
  readonly title: string;
  readonly faqs: readonly MarketingFaq[];
}

/**
 * The full FAQ, grouped for the /faq page. Answers about trial length, plans, staff, and fittings
 * must match what the product does today (billing.constants, MARKETING_PLANS); update them together.
 */
export const MARKETING_FAQ_GROUPS: readonly MarketingFaqGroup[] = [
  {
    title: 'Trial, plans & billing',
    faqs: [
      {
        question: 'What happens when my free trial ends? Will I lose my data?',
        answer: `Your trial lasts ${MARKETING_TRIAL_DAYS} days. If you do not subscribe when it ends, the workspace becomes read-only for up to 30 days. The public storefront stays online for the first 3 days with new bookings paused, then goes offline. After 30 days the workspace locks.`,
      },
      {
        question: 'Can I still see or export my records after cancelling?',
        answer:
          'If a trial or paid month simply expires without renewal, the workspace can remain read-only for up to 30 days. An explicit cancellation may lock access sooner. Drezivo retains the workspace data for 30 days after the subscription is no longer active; contact support for any available recovery or export option during that period.',
      },
      {
        question: 'Do I need a credit card to start?',
        answer:
          'No. Your first business can start its trial without a card or payment account. During the pilot, Drezivo subscriptions are paid manually through a listed GCash, Maya, or bank-transfer option, then you upload the payment proof in the app for review.',
      },
      {
        question: 'How much does Drezivo cost?',
        answer: `One plan, Standard, at ₱299 a month after the ${MARKETING_TRIAL_DAYS}-day free trial. It includes up to 300 active physical garments and 3 Front Desk staff. Asset limits are based on active physical garments, not the number of styles in your catalogue.`,
      },
      {
        question: 'What happens if I do not renew after the trial or a paid month?',
        answer:
          'Your workspace becomes read-only for up to 30 days and then locks. Drezivo retains the workspace data for 30 days after the subscription is no longer active, subject to limited legal, accounting, security, backup, or dispute-retention exceptions.',
      },
    ],
  },
  {
    title: 'Bookings, payments & customers',
    faqs: [
      {
        question: 'Can customers reserve without creating an account?',
        answer:
          'Yes. Guest booking is the V1 default. Customers can browse, choose a garment and dates, submit their details, and manage the booking through a secure guest link.',
      },
      {
        question: 'How does Drezivo prevent double bookings?',
        answer:
          'Drezivo tracks each real physical garment, not just a stock count. When a customer continues to payment, the system creates an exclusive hold on an eligible item and blocks overlapping dates, including preparation and cleaning time.',
      },
      {
        question: 'Does an uploaded GCash or Maya receipt mean the customer has paid?',
        answer:
          'No. A receipt is payment evidence, not proof of settled funds. The shop reviews cash or QR-payment evidence and explicitly verifies it before the reservation becomes confirmed.',
      },
      {
        question: 'Does Drezivo process customer payments or issue refunds?',
        answer:
          'Not in V1. Each shop provides its own QR/payment instructions, collects payment directly, and reviews submitted evidence. Refunds are coordinated by the shop, with Drezivo recording the approved financial outcome.',
      },
      {
        question: 'What is the difference between the rental fee and the security deposit?',
        answer:
          'They are separate amounts. The rental charge is income for the rental, while the security deposit is refundable unless the shop records an approved deduction, such as damage or an outstanding charge.',
      },
      {
        question: 'Can a customer cancel or change their reservation?',
        answer:
          'Not through the guest link in V1. Customers should contact the rental business directly. The business handles any cancellation or date change, and cancellation does not automatically issue a refund.',
      },
    ],
  },
  {
    title: 'Running your shop',
    faqs: [
      {
        question: 'Who decides rental prices, deposits, cancellation rules, and refunds?',
        answer:
          'The rental business does. Drezivo provides the workflow and records; each shop remains the merchant responsible for its own prices, policies, customer communication, garment condition, and refunds.',
      },
      {
        question: 'Can I import my existing clothing catalogue?',
        answer:
          'Not yet. CSV catalogue import is planned, but the current product adds clothing through the inventory workflow in the business app.',
      },
      {
        question: 'Can staff access everything in my account?',
        answer:
          'The Standard plan allows up to 3 Front Desk staff accounts. Staff access is role-limited; only the shop owner can manage owner-only settings and actions.',
      },
      {
        question: 'How is customer and business data protected?',
        answer:
          'The design uses tenant isolation, role-based access, audited sensitive actions, private file storage, expiring access to uploads, and minimal data collection. Customers’ reservation records are isolated from other customers and other rental businesses.',
      },
      {
        question: 'Can I offer fittings, multi-item bookings, or multiple branches?',
        answer:
          'Fittings, yes: customers can request a fitting from your storefront, and you can book walk-in fittings from the app. Multi-item bookings and multiple branches are not in V1. V1 supports one branch and one garment per booking; multi-item booking and partial returns are planned for V1.1, and multi-branch operations and transfers are V2 scope.',
      },
      {
        question: 'Are reminders, payment gateways, and delivery integrations included?',
        answer:
          'Not in V1. There is no integrated card/payment gateway, automatic payment reconciliation, SMS, live courier integration, cart, wishlist, reviews, or customer accounts required for checkout.',
      },
    ],
  },
];

export const MARKETING_FAQS: readonly MarketingFaq[] = MARKETING_FAQ_GROUPS.flatMap(
  (group) => group.faqs,
);
