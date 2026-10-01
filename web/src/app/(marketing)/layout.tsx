import { Bodoni_Moda, Caveat, Jost } from 'next/font/google';

import { MarketingMotion } from '@/components/marketing/atelier/motion/marketing-motion';
import { PageTransition, PRELOAD_SCRIPT } from '@/components/marketing/atelier/transition/page-transition';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

import 'lenis/dist/lenis.css';
import './atelier.css';

// Bodoni Moda: a Didone, the type of fashion editorial, with an optical-size axis so display sizes
// keep their hairlines. Jost: Futura-like geometric sans for reading. Caveat: handwriting, used
// only inside the "before" notebook artifacts.
const display = Bodoni_Moda({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'], variable: '--font-bodoni', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-atelier-jost', display: 'swap' });
const hand = Caveat({ subsets: ['latin'], weight: ['500'], variable: '--font-atelier-hand', display: 'swap' });

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`marketing-page flex min-h-screen flex-col ${display.variable} ${body.variable} ${hand.variable}`}>
      {/* Before first paint: decides whether motion (and, on a first visit, the preloader) runs. */}
      <script dangerouslySetInnerHTML={{ __html: PRELOAD_SCRIPT }} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <MarketingMotion />
      <PageTransition />
    </div>
  );
}
