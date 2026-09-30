import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { CONTACT_EMAIL } from '@/lib/site-urls';

export function SiteFooter() {
  return (
    <footer className="border-t border-marketing-dark-line bg-marketing-dark text-marketing-cream">
      <div className="marketing-container py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 font-display text-lg"><BrandMark className="h-7 w-7 text-marketing-gold" /><span>Drezivo</span></div>
            <p className="mt-3 max-w-xs text-sm text-marketing-cream/70">Clothing rental operations software for Philippine businesses.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-marketing-cream/70">
              <li><Link href="/#features" className="hover:text-marketing-cream">Features</Link></li>
              <li><Link href="/#how-it-works" className="hover:text-marketing-cream">How It Works</Link></li>
              <li><Link href="/pricing" className="hover:text-marketing-cream">Pricing</Link></li>
              <li><Link href="/faq" className="hover:text-marketing-cream">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-marketing-cream/70">
              <li><Link href="/terms" className="hover:text-marketing-cream">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-marketing-cream">Privacy Policy</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Stay in touch</p>
            <p className="mt-3 text-sm leading-6 text-marketing-cream/70">Built for the people keeping every fitting, pickup, and return moving.</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="mt-3 inline-block text-sm text-marketing-gold hover:text-marketing-cream">{CONTACT_EMAIL}</a>
          </div>
        </div>
        <p className="mt-12 border-t border-marketing-dark-line pt-5 text-xs text-marketing-cream/50">© {new Date().getFullYear()} Drezivo. All rights reserved.</p>
      </div>
    </footer>
  );
}
