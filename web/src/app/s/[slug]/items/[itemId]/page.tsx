import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ItemView } from '@/components/store/item-view';
import { readItem, readStore } from '@/lib/storefront-preview';
import { buildItemMetadata } from '@/lib/seo';

interface Props {
  params: Promise<{ slug: string; itemId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, itemId } = await params;
  const [store, item] = await Promise.all([readStore(slug), readItem(slug, itemId)]);
  return store && item ? buildItemMetadata(store, item) : {};
}

export default async function ItemPage({ params }: Props) {
  const { slug, itemId } = await params;
  const [store, item] = await Promise.all([readStore(slug), readItem(slug, itemId)]);
  if (!store || !item) notFound();

  const cheapest = item.variants.reduce((low, variant) => (BigInt(variant.rental_price_minor) < BigInt(low.rental_price_minor) ? variant : low));
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.image_urls.length ? { image: item.image_urls } : {}),
    brand: { '@type': 'Brand', name: store.name },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'PHP',
      price: (Number(cheapest.rental_price_minor) / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
      businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-8 sm:px-8 sm:pt-12">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm text-sf-muted">
        <Link href={`/s/${slug}/catalog`} className="hover:text-sf-ink">
          Collection
        </Link>
        {item.category ? <span> / {item.category}</span> : null}
      </nav>
      <ItemView store={store} item={item} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\u003c') }} />
    </div>
  );
}
