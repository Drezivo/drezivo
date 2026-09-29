import type { Metadata } from 'next';
import { Jost, Newsreader } from 'next/font/google';
import { notFound } from 'next/navigation';

import { StoreFooter } from '@/components/store/store-footer';
import { StoreHeader } from '@/components/store/store-header';
import { themeStyle } from '@/components/store/theme';
import { getStore } from '@/lib/storefront-api';
import { buildStorefrontMetadata } from '@/lib/seo';

const display = Newsreader({ subsets: ['latin'], weight: ['300', '400'], style: ['normal', 'italic'], variable: '--font-newsreader', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jost', display: 'swap' });

interface Props {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStore(slug);
  return store ? buildStorefrontMetadata(store) : {};
}

/**
 * Shared chrome for every page under /s/[slug]. An unknown, draft, or suspended store is one
 * generic 404 for the whole subtree, never an error that confirms the slug exists.
 */
export default async function StorefrontLayout({ children, params }: Props) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (!store) notFound();

  return (
    <div className={`storefront-shell ${display.variable} ${body.variable} flex min-h-screen flex-col`} style={themeStyle(store.theme)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-sf-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <StoreHeader store={store} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <StoreFooter store={store} />
    </div>
  );
}
