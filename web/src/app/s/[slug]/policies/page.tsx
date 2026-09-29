import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getStore } from '@/lib/storefront-api';
import { formatMinor, formatTime } from '@/lib/storefront-format';

export const metadata: Metadata = { title: 'Rental info' };
export const revalidate = 60;

export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (!store) notFound();
  const { policy, checkout, fulfillment } = store;

  const sections = [
    { id: 'renting', title: 'How renting works', body: policy.rental },
    { id: 'deposit', title: 'Security deposit', body: policy.deposit },
    { id: 'cancellation', title: 'Cancellation', body: policy.cancellation },
    { id: 'damage', title: 'Damage and late returns', body: policy.damage },
    {
      id: 'delivery',
      title: fulfillment.delivery ? 'Pickup and delivery' : 'Pickup',
      body: fulfillment.delivery
        ? `Pick up at the shop, or choose delivery${fulfillment.delivery_fee_minor !== '0' ? ` for ${formatMinor(fulfillment.delivery_fee_minor)}` : ''}.${policy.delivery_notes ? `\n\n${policy.delivery_notes}` : ''}`
        : 'Pick up and return at the shop.',
    },
    { id: 'privacy', title: 'Your privacy', body: policy.privacy_notice },
  ].filter((section): section is { id: string; title: string; body: string } => Boolean(section.body));

  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <header className="max-w-3xl">
        <h1 className="font-sf-display text-5xl font-light sm:text-6xl">Rental info</h1>
        <p className="mt-4 text-sf-muted">
          Everything to know before you reserve. You accept these terms (version {policy.version}) when you send a request.
        </p>
      </header>

      <dl className="mt-10 grid gap-px border border-sf-line bg-sf-line text-sm sm:grid-cols-3">
        {[
          ['Handover', `${formatTime(checkout.handover_time)} on pickup and return days`],
          ['Book ahead', checkout.min_notice_days === 0 ? 'Same day, when available' : `At least ${checkout.min_notice_days} day${checkout.min_notice_days === 1 ? '' : 's'}`],
          ['Longest rental', `${checkout.max_rental_days} day${checkout.max_rental_days === 1 ? '' : 's'}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-sf-bg p-5">
            <dt className="text-sf-muted">{label}</dt>
            <dd className="mt-1 font-sf-display text-2xl">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-14 grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-28 space-y-2 text-sm text-sf-muted">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="hover:text-sf-ink">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="max-w-2xl space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="font-sf-display text-3xl font-light">{section.title}</h2>
              <p className="mt-4 whitespace-pre-line leading-8 text-sf-muted">{section.body}</p>
            </section>
          ))}
          {sections.length === 0 ? <p className="text-sf-muted">This shop has not published its rental terms yet. Contact the shop before you book.</p> : null}
          <Link href={`/s/${slug}/catalog`} className="sf-button sf-button-primary">
            Browse the collection
          </Link>
        </div>
      </div>
    </div>
  );
}
