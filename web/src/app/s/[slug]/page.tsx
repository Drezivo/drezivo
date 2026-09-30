import { notFound } from 'next/navigation';

import { About, CategoryIndex, EmptyCollection, FittingBand, Hero, HowItWorks, ProductSection, RentalInfo } from '@/components/store/home-sections';
import { getStore } from '@/lib/storefront-api';

export const revalidate = 60;

export default async function StorefrontHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (!store) notFound();
  const { sections } = store.content;
  const hasClothing = store.new_arrivals.length > 0;

  return (
    <>
      <Hero store={store} />
      {hasClothing ? (
        <>
          <CategoryIndex store={store} />
          {sections.featured ? <ProductSection id="featured" store={store} title="Featured" items={store.featured} /> : null}
          <HowItWorks store={store} />
          {sections.new_arrivals ? <ProductSection id="new" store={store} title="New arrivals" lead="The latest pieces added to the collection." items={store.new_arrivals} /> : null}
        </>
      ) : (
        <EmptyCollection store={store} />
      )}
      <About store={store} />
      <RentalInfo store={store} />
      <FittingBand store={store} />
    </>
  );
}
