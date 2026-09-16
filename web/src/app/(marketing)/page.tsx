import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMarketingMetadata(
  'Clothing Rental Management Software',
  'Drezivo helps Philippine clothing rental businesses manage inventory, reservations, customers, and operations in one place.',
);

const PROBLEMS = [
  {
    title: 'Scattered inquiries',
    body: 'Customers message through Instagram, Facebook, or Messenger — and you keep track of everything manually.',
  },
  {
    title: 'Manual tracking',
    body: 'Spreadsheets and notes for reservations, inventory, and customer details are slow and error-prone.',
  },
  {
    title: 'Scheduling conflicts',
    body: "It's hard to know whether an item is available, already rented, or being cleaned — leading to double bookings.",
  },
  {
    title: 'Payment hassles',
    body: 'Customers send screenshots or cash payments, making it difficult to confirm and track transactions properly.',
  },
  {
    title: 'Lost opportunities',
    body: 'Without a proper online storefront, you miss potential customers who just want to browse and book easily.',
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          Clothing rental management software
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold text-foreground sm:text-5xl">
          Run your clothing rental business effortlessly
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-muted">
          Drezivo helps you manage your inventory, reservations, customers, and operations — all
          in one place. Less manual work, more time for what matters.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://app.drezivo.com/sign-up"
            className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
          >
            Get Started Free
          </a>
          <Link
            href="/pricing"
            className="rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground"
          >
            See Pricing
          </Link>
        </div>
        <dl className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted">
          <div className="flex items-center gap-2">
            <dt className="sr-only">Setup</dt>
            <dd>Set up in minutes</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">Trial</dt>
            <dd>14-day free trial, no card required</dd>
          </div>
        </dl>
      </section>

      <section id="features" className="border-t border-border bg-surface py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">The problem</p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-foreground">
            Running a clothing rental business shouldn&rsquo;t be this hard.
          </h2>
          <p className="mt-4 max-w-2xl text-muted">
            Many rental businesses are still stuck with manual processes, fragmented tools, and
            constant back-and-forth with customers. It&rsquo;s time for a better way.
          </p>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {PROBLEMS.map((problem, index) => (
              <li key={problem.title} className="rounded-lg border border-border bg-background p-5">
                <span className="text-xs font-semibold text-accent">{index + 1}</span>
                <p className="mt-2 font-medium text-foreground">{problem.title}</p>
                <p className="mt-2 text-sm text-muted">{problem.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="how-it-works" className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            How it works
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-foreground">
            One workspace, one published storefront.
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-6">
              <p className="font-medium text-foreground">1. Publish your catalog</p>
              <p className="mt-2 text-sm text-muted">
                Add your styles, sizes, and photos, then publish your branded storefront at
                drezivo.com/s/your-shop.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <p className="font-medium text-foreground">2. Take guest reservations</p>
              <p className="mt-2 text-sm text-muted">
                Customers browse, pick dates, and submit a reservation — no account required.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <p className="font-medium text-foreground">3. Review and hand off</p>
              <p className="mt-2 text-sm text-muted">
                Confirm payment evidence, track pickup and return, and keep every rental in one
                calendar.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-primary py-16 text-primary-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 px-6 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-display text-2xl font-semibold">
              Simplify your operations. Grow your business.
            </p>
            <p className="mt-2 text-primary-foreground/70">
              Drezivo brings everything together — from reservations to payments.
            </p>
          </div>
          <a
            href="https://app.drezivo.com/sign-up"
            className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-foreground"
          >
            Get Started Free
          </a>
        </div>
      </section>
    </>
  );
}
