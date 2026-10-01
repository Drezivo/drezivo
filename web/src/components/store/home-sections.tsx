import Link from 'next/link';

import type { CatalogueCard, PublicStorefront } from '@drezivo/contracts';

import { formatMinor, formatTime } from '@/lib/storefront-format';

import { ProductGrid } from './product-card';

const container = 'mx-auto max-w-7xl px-5 sm:px-8';

export function SectionHeading({ title, lead, action }: { title: string; lead?: string | null; action?: React.ReactNode }) {
  return (
    <div data-reveal="text" className="mb-10 flex flex-wrap items-end justify-between gap-4 sm:mb-12">
      <div className="max-w-2xl">
        <h2 className="font-sf-display text-4xl font-light leading-tight sm:text-5xl">{title}</h2>
        {lead ? <p className="mt-3 text-sf-muted">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Hero({ store }: { store: PublicStorefront }) {
  const image = store.content.hero.image_url ?? store.cover_url;
  const base = `/s/${store.slug}`;
  const actions = (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href={`${base}/catalog`} className="sf-button sf-button-primary">
        Browse the collection
      </Link>
      {store.content.sections.how_it_works ? (
        <Link href={`${base}#how-it-works`} className="sf-button sf-button-outline">
          How renting works
        </Link>
      ) : null}
    </div>
  );

  // The heading rises out of this mask; the bottom padding keeps descenders from being clipped.
  const heading = (className: string) => (
    <h1 className={`overflow-hidden pb-[0.12em] font-sf-display font-light ${className}`}>
      <span data-hero-line className="block">
        {store.content.hero.heading}
      </span>
    </h1>
  );

  if (!image) {
    return (
      <section data-hero className={`${container} py-20 sm:py-28`}>
        <div data-hero-content>
          {heading('max-w-4xl text-5xl leading-[1.05] sm:text-7xl')}
          {store.content.hero.body ? (
            <p data-hero-fade className="mt-6 max-w-xl text-lg text-sf-muted">
              {store.content.hero.body}
            </p>
          ) : null}
          <div data-hero-fade>{actions}</div>
        </div>
      </section>
    );
  }

  return (
    <section data-hero className="relative isolate flex min-h-[86svh] items-end overflow-hidden bg-sf-line">
      <div data-hero-media className="absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img src={image} alt="" className="h-full w-full object-cover object-[50%_30%]" fetchPriority="high" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/65 via-black/20 to-black/5" />
      <div data-hero-content className={`${container} w-full pb-14 pt-32 text-white sm:pb-20`}>
        {heading('max-w-3xl text-5xl leading-[1.02] sm:text-7xl')}
        {store.content.hero.body ? (
          <p data-hero-fade className="mt-5 max-w-lg text-base leading-7 text-white/85 sm:text-lg">
            {store.content.hero.body}
          </p>
        ) : null}
        <div
          data-hero-fade
          className="[&_.sf-button-outline]:border-white/80 [&_.sf-button-outline:hover]:border-white [&_.sf-button-outline:hover]:bg-white [&_.sf-button-outline:hover]:text-black"
        >
          {actions}
        </div>
      </div>
    </section>
  );
}

export function CategoryIndex({ store }: { store: PublicStorefront }) {
  if (!store.content.sections.categories || store.categories.length < 2) return null;
  return (
    <section className={`${container} pt-20 sm:pt-28`} aria-labelledby="categories-title">
      <h2 id="categories-title" className="text-sm text-sf-muted">
        Shop by category
      </h2>
      <ul data-reveal-group className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-b border-sf-line pb-8">
        {store.categories.map((category) => (
          <li key={category.id} data-reveal-item>
            <Link href={`/s/${store.slug}/catalog?category=${category.id}`} className="group inline-flex items-baseline gap-2 font-sf-display text-3xl font-light sm:text-4xl">
              <span className="border-b border-transparent transition-colors group-hover:border-current">{category.name}</span>
              <span className="font-sf-body text-xs text-sf-muted tabular-nums">{category.item_count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductSection({ store, title, lead, items, id }: { store: PublicStorefront; title: string; lead?: string; items: CatalogueCard[]; id: string }) {
  if (items.length === 0) return null;
  return (
    <section id={id} className={`${container} pt-20 sm:pt-28`}>
      <SectionHeading
        title={title}
        lead={lead ?? null}
        action={
          <Link href={`/s/${store.slug}/catalog`} className="text-sm underline decoration-sf-line underline-offset-4 hover:decoration-current">
            See the full collection
          </Link>
        }
      />
      <ProductGrid slug={store.slug} items={items} priorityCount={4} />
    </section>
  );
}

export function HowItWorks({ store }: { store: PublicStorefront }) {
  if (!store.content.sections.how_it_works) return null;
  const steps = [
    { title: 'Choose your piece and dates', body: 'Pick a size, then the days you need it. The calendar only offers dates it is free.' },
    {
      title: 'Pay and send your receipt',
      body: `Verify your email, pay with ${store.payment_methods.map((method) => method.name).join(' or ') || 'the shop’s payment method'}, and upload the receipt. Your size is held while the shop reviews it.`,
    },
    {
      title: store.fulfillment.delivery ? 'Pick up or have it delivered' : 'Pick up and return',
      body: `Handover is at ${formatTime(store.checkout.handover_time)} on your pickup date and again when you return it.`,
    },
  ];
  return (
    <section id="how-it-works" className={`${container} pt-20 sm:pt-28`}>
      <SectionHeading title="How renting works" />
      <ol data-reveal-group className="grid gap-10 border-t border-sf-line pt-10 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} data-reveal-item>
            <p className="font-sf-display text-5xl font-light text-sf-muted tabular-nums">{String(index + 1).padStart(2, '0')}</p>
            <h3 className="mt-4 font-sf-display text-2xl font-normal">{step.title}</h3>
            <p className="mt-2 max-w-sm text-sm leading-7 text-sf-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function About({ store }: { store: PublicStorefront }) {
  const { about } = store.content;
  if (!store.content.sections.about || !about.body) return null;
  return (
    <section id="about" className={`${container} pt-20 sm:pt-28`}>
      <div className={`grid items-center gap-10 ${about.image_url ? 'md:grid-cols-2 md:gap-16' : ''}`}>
        {about.image_url ? (
          <div data-reveal="image" className="aspect-[4/5] overflow-hidden bg-sf-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img src={about.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          </div>
        ) : null}
        <div data-reveal="text" className="max-w-xl">
          <h2 className="font-sf-display text-4xl font-light leading-tight sm:text-5xl">{about.heading ?? `About ${store.name}`}</h2>
          <p className="mt-6 whitespace-pre-line leading-8 text-sf-muted">{about.body}</p>
        </div>
      </div>
    </section>
  );
}

export function RentalInfo({ store }: { store: PublicStorefront }) {
  const imageTerms = store.policy.format === 'images';
  const hasTerms = imageTerms ? store.policy.image_urls.length > 0 : Boolean(store.policy.rental);
  if (!store.content.sections.rental_info || !hasTerms) return null;
  // Pictures of a policy are not quotable here; point renters to the page that shows them in full.
  const termItems = imageTerms
    ? [{ title: 'Rental terms', body: 'Deposit, cancellation, and return rules are on the Rental info page. Read them before you book.' }]
    : [
        { title: 'Deposit', body: store.policy.deposit },
        { title: 'Cancellation', body: store.policy.cancellation },
      ];
  const items = [
    ...termItems,
    {
      title: store.fulfillment.delivery ? 'Pickup and delivery' : 'Pickup',
      body: store.fulfillment.delivery
        ? `Pick up at the shop, or have it delivered${store.fulfillment.delivery_fee_minor !== '0' ? ` for ${formatMinor(store.fulfillment.delivery_fee_minor)}` : ''}. ${store.policy.delivery_notes ?? ''}`.trim()
        : 'Pick up and return at the shop.',
    },
  ].filter((item) => item.body);
  return (
    <section className={`${container} pt-20 sm:pt-28`}>
      <SectionHeading
        title="Before you rent"
        action={
          <Link href={`/s/${store.slug}/policies`} className="text-sm underline decoration-sf-line underline-offset-4 hover:decoration-current">
            Full rental terms
          </Link>
        }
      />
      <dl data-reveal-group className="grid gap-10 border-t border-sf-line pt-10 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} data-reveal-item>
            <dt className="font-sf-display text-2xl">{item.title}</dt>
            <dd className="mt-2 line-clamp-5 whitespace-pre-line text-sm leading-7 text-sf-muted">{item.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FittingBand({ store }: { store: PublicStorefront }) {
  if (!store.content.sections.fitting || !store.fitting.enabled) return null;
  return (
    <section className="mt-20 bg-sf-accent text-sf-accent-ink sm:mt-28">
      <div data-reveal="text" className={`${container} flex flex-col items-start justify-between gap-6 py-16 md:flex-row md:items-center`}>
        <div className="max-w-xl">
          <h2 className="font-sf-display text-4xl font-light">Try it on first</h2>
          <p className="mt-3 opacity-85">
            Book a {store.fitting.duration_minutes ?? 60}-minute fitting at the shop
            {store.fitting.fee_minor ? ` for ${formatMinor(store.fitting.fee_minor)}` : ''}. The shop confirms every request by email.
          </p>
        </div>
        <Link href={`/s/${store.slug}/fittings`} className="sf-button border border-current hover:opacity-80">
          Request a fitting
        </Link>
      </div>
    </section>
  );
}

export function EmptyCollection({ store }: { store: PublicStorefront }) {
  return (
    <section data-reveal="text" className={`${container} py-24 text-center`}>
      <p className="font-sf-display text-3xl font-light">New pieces are on their way.</p>
      <p className="mt-3 text-sf-muted">{store.name} has not added clothing to the storefront yet. Check back soon, or contact the shop below.</p>
    </section>
  );
}

