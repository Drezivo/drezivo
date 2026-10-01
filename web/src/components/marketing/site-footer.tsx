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
  // overflow-hidden: the watermark glyph's line box hangs ~32px below the footer and showed the page ground.
  return (
    <footer data-header="dark" className="overflow-hidden bg-atelier-night text-atelier-paper">
      <div className="at-container border-t border-atelier-night-line pb-10 pt-16 sm:pt-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr] md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <p className="flex items-center gap-3 font-[family-name:var(--font-atelier-display)] text-at-subhead leading-none">
              <Image src="/brand/drezivo-mark.png" alt="" width={497} height={600} className="h-11 w-auto" />
              Drezivo
            </p>
            <p className="mt-4 max-w-[18rem] text-at-small leading-[1.7] text-atelier-mist">Clothing rental software for Philippine shops: gowns, barong, ternos, costumes, and everything in between.</p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="at-eyebrow text-atelier-champagne">{column.title}</p>
              <ul className="mt-5 grid gap-3 text-at-small">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="at-footer-link">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="col-span-2 md:col-span-1">
            <p className="at-eyebrow text-atelier-champagne">Talk to us</p>
            <ul className="mt-5 grid gap-3 text-at-small">
              <li><a href={`mailto:${CONTACT_EMAIL}`} className="at-footer-link">{CONTACT_EMAIL}</a></li>
              <li><a href={SIGN_IN_URL} className="at-footer-link">Sign in to your shop</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-14 flex sm:mt-20 flex-wrap items-end justify-between gap-6 border-t border-atelier-night-line pt-8">
          <span aria-hidden="true" className="at-watermark" />
          <p className="text-at-micro text-atelier-mist">© {new Date().getFullYear()} Drezivo. Made in the Philippines.</p>
        </div>
      </div>
    </footer>
  );
}
