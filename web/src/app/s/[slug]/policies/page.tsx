import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PolicyImages } from '@/components/store/policy-images';
import { readStore } from '@/lib/storefront-preview';
import { formatMinor, formatTime } from '@/lib/storefront-format';

export const metadata: Metadata = { title: 'Rental info' };

type PolicySection = { id: string; title: string } & ({ body: string } | { images: readonly string[] });

export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await readStore(slug);
  if (!store) notFound();
  const { policy, checkout, fulfillment } = store;

  const terms: Array<PolicySection | null> =
    policy.format === 'images'
      ? [policy.image_urls.length > 0 ? { id: 'terms', title: 'Rental terms', images: policy.image_urls } : null]
      : [
          { id: 'renting', title: 'How renting works', body: policy.rental },
          { id: 'deposit', title: 'Security deposit', body: policy.deposit },
          { id: 'cancellation', title: 'Cancellation', body: policy.cancellation },
          policy.damage ? { id: 'damage', title: 'Damage and late returns', body: policy.damage } : null,
        ];
  const sections = [
    ...terms,
    {
      id: 'delivery',
      title: fulfillment.delivery ? 'Pickup and delivery' : 'Pickup',
      body: fulfillment.delivery
        ? `Pick up at the shop, or choose delivery${fulfillment.delivery_fee_minor !== '0' ? ` for ${formatMinor(fulfillment.delivery_fee_minor)}` : ''}.${policy.delivery_notes ? `\n\n${policy.delivery_notes}` : ''}`
        : 'Pick up and return at the shop.',
    },
    { id: 'privacy', title: 'Your privacy', body: policy.privacy_notice },
  ].filter((section): section is PolicySection => section !== null && ('images' in section || Boolean(section.body)));
  const hasTerms = sections.some((section) => section.id !== 'delivery' && section.id !== 'privacy');

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
        {/* Wide enough for a photographed policy page to stay legible; prose keeps a shorter line. */}
        <div className="min-w-0 max-w-4xl space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="font-sf-display text-3xl font-light">{section.title}</h2>
              {'images' in section ? (
                <div className="mt-6">
                  <PolicyImages urls={section.images} shopName={store.name} />
                </div>
              ) : (
                <p className="mt-4 max-w-2xl whitespace-pre-line leading-8 text-sf-muted">{section.body}</p>
              )}
            </section>
          ))}
          {!hasTerms ? <p className="text-sf-muted">This shop has not published its rental terms yet. Contact the shop before you book.</p> : null}
          <Link href={`/s/${slug}/catalog`} className="sf-button sf-button-primary">
            Browse the collection
          </Link>
        </div>
      </div>
    </div>
  );
}
