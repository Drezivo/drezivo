import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publicApiClient } from '@/lib/api-client';
import { CatalogItemCard } from '@/components/storefront/catalog-item-card';

/**
 * Server-rendered tenant storefront home page (Drezivo-TRD.md §1: "Server-
 * render public catalogue; interactive booking/calendar. Do not duplicate
 * business writes in Next.js route handlers.").
 *
 * This page renders ONLY published, customer-safe projections returned by
 * `publicApiClient` — it never queries anything tenant-internal. A foreign
 * slug or a tenant that has not published a storefront returns `notFound()`
 * (thrown from the parent layout's lookup, and again defensively here),
 * never a distinct error state — an attacker probing slugs must not be able
 * to tell "this store doesn't exist" apart from "this store exists but
 * hasn't published yet."
 */
export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = await publicApiClient.getStore(slug);
  if (!store) {
    notFound();
  }

  const featured = await publicApiClient.getCatalog(slug, { pageSize: '5' });

  return (
    <>
      <section className="relative">
        <div className="relative h-[420px] w-full bg-border">
          {store.coverImageUrl ? (
            <Image
              src={store.coverImageUrl}
              alt=""
              fill
              priority
              className="object-cover"
              sizes="100vw"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
        </div>
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto w-full max-w-6xl px-6 pb-12">
            <p className="text-sm font-medium uppercase tracking-widest text-white/80">
              Welcome to
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold text-white sm:text-5xl">
              {store.displayName}
            </h1>
            {store.shortDescription ? (
              <p className="mt-3 max-w-xl text-white/90">{store.shortDescription}</p>
            ) : null}
            <Link
              href={`/s/${slug}/catalog`}
              className="mt-6 inline-block rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
            >
              Browse Collection
            </Link>
          </div>
        </div>
      </section>

      {store.categories.length > 0 ? (
        <section className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Shop by Category
            </h2>
            <Link href={`/s/${slug}/catalog`} className="text-sm text-accent">
              View All Categories
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {store.categories.map((category) => (
              <Link
                key={category.id}
                href={`/s/${slug}/catalog?category=${encodeURIComponent(category.id)}`}
                className="rounded-lg border border-border bg-surface p-4 text-center"
              >
                <p className="text-sm font-medium text-foreground">{category.name}</p>
                <p className="text-xs text-muted">{category.itemCount} items</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {featured.items.length > 0 ? (
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Featured Collection
            </h2>
            <Link href={`/s/${slug}/catalog`} className="text-sm text-accent">
              View All
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {featured.items.map((item) => (
              <CatalogItemCard key={item.id} storeSlug={slug} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
            This shop hasn&rsquo;t published any items yet.
          </p>
        </section>
      )}
    </>
  );
}
