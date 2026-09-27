import { staticStorefrontClient } from '@/lib/static-storefront-client';
import { notFound } from 'next/navigation';

/**
 * Renders exactly the policy fields the tenant published at onboarding
 * (Drezivo-PRD.md §4: "Publish requires contact, policy, payment
 * instruction..."). No default/fallback policy text is invented here — if a
 * field is genuinely unset, it is simply omitted rather than guessed at.
 */
export default async function StorePoliciesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = await staticStorefrontClient.getStore(slug);
  if (!store) {
    notFound();
  }

  const policyEntries: Array<[string, string | undefined]> = [
    ['Rental Duration', store.policies.rentalDurationLabel],
    ['Security Deposit', store.policies.securityDepositLabel],
    ['Pickup / Return', store.policies.pickupReturnInfo],
    ['Delivery', store.policies.deliveryInfo],
    ['Cancellation Policy', store.policies.cancellationPolicy],
  ];

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-semibold text-foreground">Rental Policies</h1>
      <p className="mt-2 text-sm text-muted">
        Everything you need to know before renting from {store.displayName}.
      </p>

      <dl className="mt-8 divide-y divide-border rounded-lg border border-border bg-surface">
        {policyEntries
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="p-6">
              <dt className="font-medium text-foreground">{label}</dt>
              <dd className="mt-2 text-sm text-muted">{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
