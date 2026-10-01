import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FittingFlow } from '@/components/store/fitting-flow';
import { previewToken, readCatalogue, readStore } from '@/lib/storefront-preview';

export const metadata: Metadata = { title: 'Request a fitting' };

export default async function FittingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await readStore(slug);
  if (!store || !store.fitting.enabled) notFound();
  const [catalogue, preview] = await Promise.all([readCatalogue(slug, { page_size: '48' }), previewToken()]);

  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <header className="mb-12 max-w-2xl">
        <h1 className="font-sf-display text-5xl font-light sm:text-6xl">Request a fitting</h1>
        <p className="mt-4 text-sf-muted">Try pieces on at the shop before you rent. Choose a time and up to three pieces; {store.name} confirms every request by email.</p>
      </header>
      {preview ? (
        <p className="border border-sf-line p-6 text-sf-muted">Fitting requests open once you publish your storefront.</p>
      ) : !store.booking_open ? (
        <p className="border border-sf-line p-6 text-sf-muted">Online fitting requests are paused for now. Contact the shop to book a fitting.</p>
      ) : (
        <FittingFlow store={store} items={catalogue.items} />
      )}
    </div>
  );
}
