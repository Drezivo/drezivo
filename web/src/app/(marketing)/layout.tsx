import { preconnect } from 'react-dom';
import '@fontsource-variable/bodoni-moda/opsz.css';
import '@fontsource-variable/bodoni-moda/opsz-italic.css';
import '@fontsource-variable/caveat/wght.css';
import '@fontsource-variable/jost/wght.css';

import { MarketingMotion } from '@/components/marketing/atelier/motion/marketing-motion';
import { PageTransition, PRELOAD_SCRIPT } from '@/components/marketing/atelier/transition/page-transition';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { PARTNERS_URL, SIGN_IN_URL, SIGN_UP_URL } from '@/lib/site-urls';

import 'lenis/dist/lenis.css';
import './atelier.css';

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
    <div className="marketing-page flex min-h-screen flex-col">
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
