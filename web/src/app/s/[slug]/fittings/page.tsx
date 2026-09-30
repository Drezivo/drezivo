import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FittingFlow } from '@/components/store/fitting-flow';
import { getCatalogue, getStore } from '@/lib/storefront-api';

export const metadata: Metadata = { title: 'Request a fitting' };

export default async function FittingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (!store || !store.fitting.enabled) notFound();
  const catalogue = await getCatalogue(slug, { page_size: '48' });

  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <header className="mb-12 max-w-2xl">
        <h1 className="font-sf-display text-5xl font-light sm:text-6xl">Request a fitting</h1>
        <p className="mt-4 text-sf-muted">Try pieces on at the shop before you rent. Choose a time and up to three pieces; {store.name} confirms every request by email.</p>
      </header>
      <FittingFlow store={store} items={catalogue.items} />
    </div>
  );
}
