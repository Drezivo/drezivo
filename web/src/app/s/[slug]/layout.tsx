import type { Metadata } from 'next';
import { Jost, Newsreader } from 'next/font/google';
import { notFound } from 'next/navigation';

import 'lenis/dist/lenis.css';

import { MotionRoot } from '@/components/store/motion/motion-root';
import { StoreFooter } from '@/components/store/store-footer';
import { StoreHeader } from '@/components/store/store-header';
import { themeStyle } from '@/components/store/theme';
import { PreviewProvider } from '@/components/store/preview-context';
import { previewToken, readStore } from '@/lib/storefront-preview';
import { buildStorefrontMetadata } from '@/lib/seo';

const display = Newsreader({ subsets: ['latin'], weight: ['300', '400'], style: ['normal', 'italic'], variable: '--font-newsreader', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jost', display: 'swap' });

const MOTION_BOOT = "if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('sf-motion')";

interface Props {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = await readStore(slug);
  if (!store) return {};
  const metadata = buildStorefrontMetadata(store);
  // A preview is never indexed, even if a crawler somehow holds the preview cookies.
  return (await previewToken()) ? { ...metadata, robots: { index: false, follow: false } } : metadata;
}

/**
 * Shared chrome for every page under /s/[slug]. An unknown, draft, or suspended store is one
 * generic 404 for the whole subtree, never an error that confirms the slug exists.
 */
export default async function StorefrontLayout({ children, params }: Props) {
  const { slug } = await params;
  const [store, preview] = await Promise.all([readStore(slug), previewToken()]);
  if (!store) notFound();

  return (
    <div className={`storefront-shell ${display.variable} ${body.variable} flex min-h-screen flex-col`} style={themeStyle(store.theme)}>
      {/* Runs before the page paints, so reveal targets start hidden instead of flashing. */}
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      <MotionRoot />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-sf-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      {preview ? (
        <div role="status" className="relative z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-[#1f1b16] px-4 py-2 text-center text-xs text-[#f3eee6]">
          <span>Preview. Renters cannot see this storefront until you publish it. Booking is turned off.</span>
          <a href={`/s/${slug}/preview/exit`} className="underline underline-offset-2">
            Exit preview
          </a>
        </div>
      ) : null}
      <PreviewProvider preview={Boolean(preview)}>
        <StoreHeader store={store} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <StoreFooter store={store} />
      </PreviewProvider>
    </div>
  );
}
