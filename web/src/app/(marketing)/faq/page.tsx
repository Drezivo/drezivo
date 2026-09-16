import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMarketingMetadata(
  'FAQ',
  'Frequently asked questions about Drezivo, guest bookings, and billing.',
);

const FAQS = [
  {
    question: 'Do customers need to create an account to book?',
    answer:
      'No. In V1, customers book as guests. After submitting a reservation, they verify their email and receive a private status link — no password, no account required.',
  },
  {
    question: 'How does a guest check the status of their reservation?',
    answer:
      'Every guest reservation gets a private, unguessable status link sent to the email they provided. That link — not the reference number and not the email address by itself — is what proves it is really their reservation.',
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

export default function FaqPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">FAQ</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-foreground">
          Frequently asked questions
        </h1>
      </div>

      <dl className="mt-12 divide-y divide-border rounded-lg border border-border bg-surface">
        {FAQS.map((faq) => (
          <div key={faq.question} className="p-6">
            <dt className="font-medium text-foreground">{faq.question}</dt>
            <dd className="mt-2 text-sm text-muted">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
