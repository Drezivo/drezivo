import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { publicApiClient } from '@/lib/api-client';
import { buildStorefrontMetadata } from '@/lib/seo';
import { StoreHeader } from '@/components/storefront/store-header';
import { StoreFooter } from '@/components/storefront/store-footer';

interface StorefrontLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: StorefrontLayoutProps): Promise<Metadata> {
  const { slug } = await params;
  const store = await publicApiClient.getStore(slug);
  if (!store) return {};
  return buildStorefrontMetadata(store);
}

/**
 * Shared chrome for every page under /s/[slug]. A foreign or unpublished
 * store slug returns notFound() here, once, for the whole subtree — every
 * nested page inherits that behavior instead of re-implementing the check,
 * and (per Drezivo-TRD.md §3) the response is a generic 404, never an error
 * page that would confirm whether a store with that slug exists at all.
 */
export default async function StorefrontLayout({ children, params }: StorefrontLayoutProps) {
  const { slug } = await params;
  const store = await publicApiClient.getStore(slug);

  if (!store) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <StoreHeader store={store} />
      <main className="flex-1">{children}</main>
      <StoreFooter store={store} />
    </div>
  );
}
