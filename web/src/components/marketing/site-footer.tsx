import Image from 'next/image';
import Link from 'next/link';

import { CONTACT_EMAIL, SIGN_IN_URL } from '@/lib/site-urls';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/#before-after', label: 'Why Drezivo' },
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer data-header="dark" className="bg-atelier-night text-atelier-paper">
      <div className="at-container border-t border-atelier-night-line pb-10 pt-20">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <p className="flex items-center gap-3 font-[family-name:var(--font-atelier-display)] text-[2rem] leading-none">
              <Image src="/brand/drezivo-mark.png" alt="" width={497} height={600} className="h-11 w-auto" />
              Drezivo
            </p>
            <p className="mt-4 max-w-[18rem] text-sm leading-[1.7] text-atelier-mist">Clothing rental software for Philippine shops: gowns, barong, ternos, costumes, and everything in between.</p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="at-eyebrow text-[0.6875rem] text-atelier-champagne">{column.title}</p>
              <ul className="mt-5 grid gap-3 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="at-footer-link">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="at-eyebrow text-[0.6875rem] text-atelier-champagne">Talk to us</p>
            <ul className="mt-5 grid gap-3 text-sm">
              <li><a href={`mailto:${CONTACT_EMAIL}`} className="at-footer-link">{CONTACT_EMAIL}</a></li>
              <li><a href={SIGN_IN_URL} className="at-footer-link">Sign in to your shop</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-20 flex flex-wrap items-end justify-between gap-6 border-t border-atelier-night-line pt-8">
          <span aria-hidden="true" className="at-watermark" />
          <p className="text-xs text-atelier-mist">© {new Date().getFullYear()} Drezivo. Made in the Philippines.</p>
        </div>
      </div>
    </footer>
  );
}
