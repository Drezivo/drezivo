import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StorefrontDressMark } from '@/components/storefront/storefront-brand';
import { StorefrontHomeItemCard } from '@/components/storefront/storefront-home-item-card';
import { publicApiClient } from '@/lib/api-client';

type StoreProjection = NonNullable<Awaited<ReturnType<typeof publicApiClient.getStore>>>;
type CatalogItemSummary = Awaited<ReturnType<typeof publicApiClient.getCatalog>>['items'][number];

/** Published tenant storefront home, modeled on the approved storefront reference. */
export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = await publicApiClient.getStore(slug);

  // Resolve publication first so an unknown or unpublished slug stays a generic 404
  // instead of surfacing a downstream catalogue error that could reveal state.
  if (!store) {
    notFound();
  }

  const collection = await publicApiClient.getCatalog(slug, { pageSize: '20' });
  const categoryImages = getCategoryImages(collection.items);

  return (
    <>
      <section id="about" className="overflow-hidden bg-storefront-hero">
        <div className="mx-auto grid max-w-7xl lg:grid-cols-5">
          <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:col-span-2 lg:px-20 lg:py-12">
            <div className="flex items-start gap-5">
              <StorefrontDressMark className="mt-1 h-16 w-12 shrink-0 text-storefront-brand" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-storefront-ink">
                  Welcome to
                </p>
                <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-storefront-brand sm:text-4xl">
                  {store.displayName}
                </h1>
                <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-storefront-ink">
                  Clothing rentals for special moments
                </p>
              </div>
            </div>

            {store.shortDescription ? (
              <p className="mt-5 max-w-lg text-sm leading-6 text-storefront-ink">
                {store.shortDescription}
              </p>
            ) : null}

            <div className="mt-6">
              <Link
                href={`/s/${slug}/catalog`}
                className="inline-flex min-h-11 items-center gap-3 rounded-md bg-storefront-brand px-6 text-sm font-semibold text-storefront-paper transition hover:bg-storefront-accent"
              >
                Browse Collection <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <div className="relative min-h-72 bg-storefront-soft lg:col-span-3">
            {store.coverImageUrl ? (
              <Image
                src={store.coverImageUrl}
                alt={`${store.displayName} rental collection`}
                fill
                priority
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-storefront-brand/30">
                <StorefrontDressMark className="h-40 w-28" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-storefront-hero/25 via-transparent to-transparent" />
          </div>
        </div>
      </section>

      {store.categories.length > 0 ? (
        <section id="categories" className="mx-auto max-w-7xl px-6 py-10 sm:px-10 lg:px-20">
          <SectionHeading
            title="Shop by Category"
            subtitle="Find the perfect look for your special occasion."
            actionHref={`/s/${slug}/catalog`}
            actionLabel="View All Categories"
          />

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {store.categories.map((category: StoreProjection['categories'][number]) => {
              const imageUrl = categoryImages.get(category.name);
              return (
                <Link
                  key={category.id}
                  href={`/s/${slug}/catalog?category=${encodeURIComponent(category.id)}`}
                  className="group overflow-hidden rounded-md border border-storefront-line bg-storefront-paper shadow-storefront-card transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden bg-storefront-soft">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={`${category.name} rental clothing`}
                        fill
                        sizes="(min-width: 1024px) 13vw, (min-width: 640px) 24vw, 48vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-storefront-brand/30">
                        <StorefrontDressMark className="h-16 w-12" />
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="truncate text-xs font-semibold text-storefront-ink">
                      {category.name}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-6 pb-14 pt-2 sm:px-10 lg:px-20">
        <SectionHeading
          title="Most Rented"
          subtitle="Explore dresses, gowns, and outfits for your special moments."
          actionHref={`/s/${slug}/catalog`}
          actionLabel="View All"
        />

        {collection.items.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {collection.items.map((item: CatalogItemSummary) => (
              <StorefrontHomeItemCard key={item.id} storeSlug={slug} item={item} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-dashed border-storefront-line bg-storefront-paper px-6 py-12 text-center">
            <StorefrontDressMark className="mx-auto h-14 w-10 text-storefront-brand/30" />
            <p className="mt-4 text-sm text-storefront-muted">
              This shop hasn&apos;t published any clothing yet.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function SectionHeading({
  title,
  subtitle,
  actionHref,
  actionLabel,
}: {
  title: string;
  subtitle: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-storefront-ink sm:text-3xl">
          {title}
        </h2>
        <p className="mt-1 text-sm text-storefront-muted">{subtitle}</p>
      </div>
      <Link
        href={actionHref}
        className="hidden min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-storefront-ink hover:text-storefront-brand sm:inline-flex"
      >
        {actionLabel} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function getCategoryImages(items: CatalogItemSummary[]): Map<string, string> {
  const images = new Map<string, string>();
  for (const item of items) {
    if (!images.has(item.categoryName)) {
      images.set(item.categoryName, item.primaryImageUrl);
    }
  }
  return images;
}
