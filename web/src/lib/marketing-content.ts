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

export const MARKETING_PLANS: readonly MarketingPlan[] = [
  {
    name: 'Starter',
    price: '300.00',
    blurb: 'Perfect for small businesses just getting started.',
    features: [
      'Up to 125 active physical assets',
      'Owner-only access',
      'Reservations, calendar & availability',
      'Customer management',
      'Returns, refunds & exports',
    ],
  },
  {
    name: 'Professional',
    price: '499.00',
    blurb: 'For growing businesses with more rentals and customers.',
    features: [
      'Up to 300 active physical assets',
      'Owner + up to 2 Front desk seats',
      'Everything in Starter',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    name: 'Business',
    price: '1299.00',
    blurb: 'For established businesses with higher volume.',
    features: [
      'Up to 1,000 active physical assets',
      'Owner + up to 10 Front desk seats',
      'Everything in Professional',
    ],
  },
];

export const MARKETING_FAQS: readonly MarketingFaq[] = [
  {
    question: 'Do customers need to create an account to book?',
    answer:
      'No. In V1, customers book as guests. After submitting a reservation, they verify their email and receive a private status link—no password or account required.',
  },
  {
    question: 'How does a guest check the status of their reservation?',
    answer:
      'Every guest reservation gets a private, unguessable status link sent to the email they provided. The link—not the reference number or email address alone—is what proves it is really their reservation.',
  },
  {
    question: 'What payment methods are supported?',
    answer:
      'V1 supports GCash and Maya via merchant-provided QR codes, plus cash collected in person. The business reviews uploaded payment evidence before confirming a reservation.',
  },
  {
    question: 'Is there a security deposit?',
    answer:
      'Many businesses require a refundable security deposit in addition to the rental fee. Deposit amounts and refund terms are set per business and shown before checkout.',
  },
  {
    question: 'Can a reservation be cancelled or rescheduled?',
    answer:
      "Yes, subject to the business's own cancellation policy shown on their storefront. A cancellation request does not release the held item until the business processes it.",
  },
  {
    question: 'How much does Drezivo cost?',
    answer:
      'Starter is ₱300/month, Professional is ₱499/month, and Business is ₱1,299/month. See the Pricing page for what each plan includes.',
  },
];
