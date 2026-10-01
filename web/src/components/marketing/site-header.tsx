'use client';

import gsap from 'gsap';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EASE_DRAMA, EASE_REVEAL, lockScroll, motionAllowed } from './atelier/motion/motion-tokens';
import { SIGN_IN_URL, SIGN_UP_URL } from '@/lib/site-urls';

const NAV_LINKS = [
  { href: '/#before-after', label: 'Why Drezivo' },
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];

const BARS = { top: 'M4 8 L20 8', bottom: 'M4 16 L20 16' };
const CROSS = { top: 'M6 6 L18 18', bottom: 'M6 18 L18 6' };

type Ground = 'dark' | 'light';

/**
 * Header for Drezivo's own marketing pages only. It reads the ground of the section beneath it
 * (`data-header` on each section): transparent with light type over the night sections, paper
 * with a hairline over the light ones. Phones get a full-screen menu.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [ground, setGround] = useState<Ground>('light');
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const top = useRef<SVGPathElement>(null);
  const bottom = useRef<SVGPathElement>(null);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 24);
      // The section under the middle of the header bar decides its colours.
      const probe = document.elementsFromPoint(window.innerWidth / 2, 36).find((element) => element.closest('[data-header]'));
      const section = probe?.closest<HTMLElement>('[data-header]');
      setGround(section?.dataset['header'] === 'dark' ? 'dark' : 'light');
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const animate = motionAllowed();
    lockScroll(open);
    if (top.current && bottom.current) {
      const shape = open ? CROSS : BARS;
      if (animate) {
        gsap.to(top.current, { attr: { d: shape.top }, duration: 0.45, ease: EASE_DRAMA });
        gsap.to(bottom.current, { attr: { d: shape.bottom }, duration: 0.45, ease: EASE_DRAMA });
      } else {
        top.current.setAttribute('d', shape.top);
        bottom.current.setAttribute('d', shape.bottom);
      }
    }
    if (open && animate && menu.current) {
      gsap.fromTo(menu.current.querySelectorAll('[data-menu-item]'), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: EASE_REVEAL, stagger: 0.05, delay: 0.1 });
    }
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const dark = open || ground === 'dark';
  return (
    <header className="at-header fixed inset-x-0 top-0 z-50" data-ground={dark ? 'dark' : 'light'} data-scrolled={scrolled && !open ? '' : undefined}>
      <div className="at-container flex h-[4.5rem] items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Drezivo home">
          <Image src="/brand/drezivo-mark.png" alt="" width={497} height={600} priority className="h-9 w-auto" />
          <span className="font-[family-name:var(--font-atelier-display)] text-at-title leading-none">Drezivo</span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="at-nav-link text-at-body">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <a href={SIGN_IN_URL} className="at-nav-link px-3 py-2 text-at-body">Sign in</a>
          <a href={SIGN_UP_URL} className={`at-button at-button-sm ${dark ? 'at-button-light' : 'at-button-dark'}`}>Start free trial</a>
        </div>

        <button
          type="button"
          className="relative z-10 -mr-2 grid h-11 w-11 place-items-center lg:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path ref={top} d={BARS.top} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path ref={bottom} d={BARS.bottom} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div ref={menu} id="site-menu" hidden={!open} className="at-menu lg:hidden">
        <nav className="at-container flex h-full flex-col justify-between pb-10 pt-28" aria-label="Menu">
          <ul className="grid gap-2">
            {NAV_LINKS.map((link) => (
              <li key={link.href} data-menu-item>
                <Link href={link.href} onClick={() => setOpen(false)} className="block py-2 font-[family-name:var(--font-atelier-display)] text-at-display leading-tight">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div data-menu-item className="grid gap-3">
            <a href={SIGN_UP_URL} className="at-button at-button-light justify-center">Start free trial</a>
            <a href={SIGN_IN_URL} className="at-button at-button-ghost-dark justify-center">Sign in</a>
          </div>
        </nav>
      </div>
    </header>
  );
}
