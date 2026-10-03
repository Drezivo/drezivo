'use client';

import gsap from 'gsap';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { lockPageScroll } from './scroll';

/** Enough cells for the largest grid (12 × 8); the grid itself is sized by CSS breakpoints (globals.css). */
const CELL_COUNT = 96;
/** A page that never arrives must not leave the shop covered. */
const MAX_COVER_MS = 8000;

/**
 * The landing page's mosaic, in the shop's own colours: on a link to another page of this
 * storefront the screen breaks into blocks that appear in random order, holds while the next page
 * renders, then clears block by block. Blocks are painted with the shop's --sf-* tokens (see
 * .sf-mosaic in globals.css), so every theme gets its own transition. Reduced motion, modified
 * clicks, other sites, and links within the same page navigate normally.
 */
export function StoreTransition({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const overlay = useRef<HTMLDivElement>(null);
  const pending = useRef<null | (() => void)>(null);
  const busy = useRef(false);

  const cells = () => Array.from(overlay.current?.children ?? []) as HTMLElement[];

  const cover = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const root = overlay.current;
        if (!root) return resolve();
        root.dataset['active'] = '';
        gsap.killTweensOf(cells());
        gsap.fromTo(
          cells(),
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.16, ease: 'none', stagger: { amount: 0.42, from: 'random' }, onComplete: resolve },
        );
      }),
    [],
  );

  const reveal = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const root = overlay.current;
        if (!root) return resolve();
        gsap.to(cells(), {
          autoAlpha: 0,
          duration: 0.2,
          ease: 'none',
          stagger: { amount: 0.5, from: 'random' },
          onComplete: () => {
            delete root.dataset['active'];
            resolve();
          },
        });
      }),
    [],
  );

  useEffect(() => {
    const base = `/s/${slug}`;
    const onClick = (event: MouseEvent) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return;
      // Leaving preview is a server redirect, not a page of the shop.
      if (url.pathname.startsWith(`${base}/preview`)) return;
      // Same page (catalogue filters, in-page sections): no transition.
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        const unlock = lockPageScroll();
        try {
          await cover();
          const arrived = new Promise<void>((resolve) => {
            pending.current = resolve;
            window.setTimeout(resolve, MAX_COVER_MS);
          });
          router.push(`${url.pathname}${url.search}${url.hash}`);
          await arrived;
        } finally {
          pending.current = null;
          unlock();
          await reveal();
          busy.current = false;
        }
      })();
    };
    // Capture phase: runs before Next's Link handler, which then sees the prevented event and skips
    // its own navigation while the mosaic takes over.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [cover, reveal, router, slug]);

  // The new page has rendered: release the waiting transition after two frames of layout.
  useEffect(() => {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }, [pathname]);

  return (
    <div ref={overlay} aria-hidden="true" className="sf-mosaic">
      {Array.from({ length: CELL_COUNT }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
