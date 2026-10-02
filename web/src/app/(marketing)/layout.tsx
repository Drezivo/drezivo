import { Bodoni_Moda, Caveat, Jost } from 'next/font/google';
import { preconnect } from 'react-dom';

import { MarketingMotion } from '@/components/marketing/atelier/motion/marketing-motion';
import { PageTransition, PRELOAD_SCRIPT } from '@/components/marketing/atelier/transition/page-transition';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { PARTNERS_URL, SIGN_IN_URL, SIGN_UP_URL } from '@/lib/site-urls';

import 'lenis/dist/lenis.css';
import './atelier.css';

// Bodoni Moda: a Didone, the type of fashion editorial, with an optical-size axis so display sizes
// keep their hairlines. Jost: Futura-like geometric sans for reading. Caveat: handwriting, used
// only inside the "before" notebook artifacts.
const display = Bodoni_Moda({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'], variable: '--font-bodoni', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-atelier-jost', display: 'swap' });
const hand = Caveat({ subsets: ['latin'], weight: ['500'], variable: '--font-atelier-hand', display: 'swap' });

// Sign in / Get started open the business app on another subdomain of the same site. Chrome
// prerenders those two pages as soon as the pointer rests on a link (eagerness "moderate"), so the
// click shows an already-rendered page. Browsers without speculation rules ignore this.
const SPECULATION_RULES = JSON.stringify({
  prerender: [{ urls: [SIGN_IN_URL, SIGN_UP_URL], eagerness: 'moderate' }],
  // Fallback where prerendering is unavailable: at least the page itself is already downloaded.
  prefetch: [{ urls: [SIGN_IN_URL, SIGN_UP_URL], eagerness: 'moderate' }],
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  preconnect(PARTNERS_URL);
  return (
    <div className={`marketing-page flex min-h-screen flex-col ${display.variable} ${body.variable} ${hand.variable}`}>
      {/* Before first paint: decides whether motion (and, on a first visit, the preloader) runs. */}
      <script dangerouslySetInnerHTML={{ __html: PRELOAD_SCRIPT }} />
      <script type="speculationrules" dangerouslySetInnerHTML={{ __html: SPECULATION_RULES }} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <MarketingMotion />
      <PageTransition />
    </div>
  );
}
