import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { staticStorefrontClient } from '@/lib/static-storefront-client';
import { SizeSelector } from '@/components/storefront/size-selector';
import { formatPhp, formatPhpPerUnit } from '@/lib/money';

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const item = await staticStorefrontClient.getCatalogItem(slug, itemId);

  if (!item) {
    // A foreign or archived item behind this store must 404 the same way a
    // foreign store does — no distinct "item not found within a real store"
    // state that would confirm the store itself exists to a prober who
    // guessed the slug but not a valid item id.
    notFound();
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <Link href={`/s/${slug}/catalog`} className="text-sm text-muted">
        ← Back to Catalog
      </Link>

      <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_420px]">
        <div>
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-border">
            <Image
              src={item.images[0] ?? ''}
              alt={item.name}
              fill
              priority
              className="object-cover"
              sizes="(min-width: 1024px) 55vw, 100vw"
            />
          </div>
          {item.images.length > 1 ? (
            <div className="mt-4 grid grid-cols-6 gap-2">
              {item.images.slice(1).map((imageUrl) => (
                <div
                  key={imageUrl}
                  className="relative aspect-square overflow-hidden rounded-md bg-border"
                >
                  <Image src={imageUrl} alt="" fill className="object-cover" sizes="120px" />
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-10 border-t border-border pt-8">
            <h2 className="font-display text-xl font-semibold text-foreground">About This Item</h2>
            <p className="mt-3 text-sm text-muted">{item.description}</p>
          </div>

          {item.measurements.length > 0 ? (
            <div className="mt-8">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Measurements (approx.)
              </h2>
              <dl className="mt-3 divide-y divide-border text-sm">
                {item.measurements.map((measurement) => (
                  <div
                    key={measurement.label}
                    className="flex justify-between py-2 text-foreground"
                  >
                    <dt className="text-muted">{measurement.label}</dt>
                    <dd>{measurement.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted">
                Measurements are approximate and may vary slightly by style.
              </p>
            </div>
          ) : null}
        </div>

        <aside className="h-fit rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-muted">{item.categoryName}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
            {item.name}
          </h1>
          <p className="mt-3 font-display text-3xl font-semibold text-foreground">
            {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Security Deposit: {formatPhp(item.securityDepositDecimal)} (refundable)
          </p>

          <div className="mt-6">
            <SizeSelector storeSlug={slug} itemId={itemId} sizes={item.sizes} />
          </div>

          <p className="mt-4 text-center text-xs text-muted">
            You&rsquo;ll pick your rental dates on the next step. Your information stays private.
          </p>
        </aside>
      </div>
    </section>
  );
}
