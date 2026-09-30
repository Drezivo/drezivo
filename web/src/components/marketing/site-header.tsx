'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from './brand-mark';
import { SIGN_IN_URL, SIGN_UP_URL } from '@/lib/site-urls';

const NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

const HEADER_SCROLL_THRESHOLD = 40;

/** Header for Drezivo's own marketing pages only — never rendered on a tenant storefront. */
export function SiteHeader() {
  const pathname = usePathname();
  const isHomePage = pathname === '/';
  const [isScrolled, setIsScrolled] = useState(!isHomePage);

  useEffect(() => {
    if (!isHomePage) {
      setIsScrolled(true);
      return;
    }

    const updateHeaderState = () => setIsScrolled(window.scrollY >= HEADER_SCROLL_THRESHOLD);

    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });

    return () => window.removeEventListener('scroll', updateHeaderState);
  }, [isHomePage]);

  return (
    <header
      className="marketing-header fixed inset-x-0 top-0 z-50"
      data-state={isScrolled ? 'scrolled' : 'overlay'}
    >
      <div className="marketing-container flex min-h-[var(--marketing-header-height)] items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-normal text-marketing-ink">
          <BrandMark className="h-8 w-8" />
          <span>Drezivo</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-marketing-muted transition-colors hover:text-marketing-ink">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 sm:flex">
          <a href={SIGN_IN_URL} className="marketing-button-secondary px-4 py-2 text-sm">Sign In</a>
          <a href={SIGN_UP_URL} className="marketing-button-primary px-4 py-2 text-sm">Get Started</a>
        </div>
        <details className="relative sm:hidden">
          <summary className="marketing-button-secondary cursor-pointer list-none px-3 py-2 text-sm">Menu</summary>
          <nav className="absolute right-0 z-20 mt-3 grid min-w-52 gap-1 rounded-xl border border-marketing-line bg-marketing-panel p-2 shadow-xl" aria-label="Mobile navigation">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm text-marketing-ink hover:bg-marketing-cream">{link.label}</Link>
            ))}
            <a href={SIGN_IN_URL} className="rounded-lg px-3 py-2 text-sm text-marketing-ink hover:bg-marketing-cream">Sign In</a>
            <a href={SIGN_UP_URL} className="marketing-button-primary mt-1 px-3 py-2 text-center text-sm">Get Started</a>
          </nav>
        </details>
      </div>
    </header>
  );
}
