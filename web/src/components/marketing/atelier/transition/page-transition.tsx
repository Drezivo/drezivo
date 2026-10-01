'use client';

import gsap from 'gsap';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { lockScroll, motionAllowed, resetScroll } from '../motion/motion-tokens';
import { Preloader } from './preloader';

/** Marketing routes that share this layout; only links between them play the mosaic. */
const MARKETING_PATHS = new Set(['/', '/pricing', '/faq', '/privacy', '/terms', '/contact', '/support']);
const PRELOAD_FLAG = 'dz-atelier-preloaded';

type Ground = 'night' | 'paper';

/**
 * Enough cells for the largest grid (12 × 11). The grid itself is sized by CSS breakpoints in
 * atelier.css, so the server renders the right blocks for each screen and nothing re-grids (a
 * re-grid while the preloader shows counted as layout shift). Cells past the grid collapse to zero.
 */
const CELL_COUNT = 132;

/**
 * The mosaic: the page breaks into blocks that drop out in random order, the screen holds on a
 * plain ground while the next page renders, then the new page arrives as the blocks clear and its
 * content sharpens out of a blur (`html.at-entering`, see atelier.css). Also the preloader's ground
 * on a first visit. Reduced motion skips all of it: links navigate instantly.
 */
export function PageTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const overlay = useRef<HTMLDivElement>(null);
  const pending = useRef<null | (() => void)>(null);
  const busy = useRef(false);
  const [ground, setGround] = useState<Ground>('night');
  const [preloading, setPreloading] = useState(false);

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
        document.documentElement.classList.add('at-entering');
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
        // The new page sharpens while the blocks clear (CSS transition on html.at-entered).
        window.setTimeout(() => document.documentElement.classList.add('at-entered'), 120);
        window.setTimeout(() => document.documentElement.classList.remove('at-entering', 'at-entered'), 1300);
      }),
    [],
  );

  // First visit in this tab: the preloader holds the night ground until the page is ready.
  useEffect(() => {
    const root = overlay.current;
    if (!root || !document.documentElement.classList.contains('at-preload')) return;
    root.dataset['active'] = '';
    gsap.set(cells(), { autoAlpha: 1 });
    setPreloading(true);
    lockScroll(true);
  }, []);

  const finishPreload = useCallback(async () => {
    try {
      sessionStorage.setItem(PRELOAD_FLAG, '1');
    } catch {
      // Private mode or blocked storage: the preloader simply shows again next visit.
    }
    setPreloading(false);
    document.documentElement.classList.remove('at-preload');
    document.documentElement.classList.add('at-hero-go');
    lockScroll(false);
    await reveal();
    window.dispatchEvent(new Event('at:revealed'));
  }, [reveal]);

  // Intercept links between marketing pages.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!motionAllowed() || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !MARKETING_PATHS.has(url.pathname)) return;
      if (url.pathname === window.location.pathname) return; // same page: in-page anchors scroll via Lenis
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      setGround('paper');
      void (async () => {
        lockScroll(true);
        await cover();
        const arrived = new Promise<void>((resolve) => {
          pending.current = resolve;
        });
        router.push(`${url.pathname}${url.search}${url.hash}`);
        await arrived;
        resetScroll(url.hash);
        lockScroll(false);
        await reveal();
        busy.current = false;
      })();
    };
    // Capture phase: runs before Next's Link handler, which then sees the prevented event and skips
    // its own navigation while the mosaic takes over.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [cover, reveal, router]);

  // The new route has rendered: release the waiting transition after two frames of layout.
  useEffect(() => {
    if (!pending.current) return;
    const resolve = pending.current;
    pending.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }, [pathname]);

  return (
    <>
      <div
        ref={overlay}
        aria-hidden="true"
        data-ground={ground}
        className="at-mosaic"
      >
        {Array.from({ length: CELL_COUNT }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      {/* Server-rendered so the mark shows before hydration; CSS shows it only under html.at-preload. */}
      <Preloader active={preloading} onDone={finishPreload} />
    </>
  );
}

/**
 * Runs before first paint. Motion allowed: first visit in the tab gets the preloader, later visits
 * play the hero entrance straight away. Storage blocked: no preloader, entrance straight away.
 */
export const PRELOAD_SCRIPT = `(function(){var d=document.documentElement;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('at-motion');var first=false;try{first=!sessionStorage.getItem('${PRELOAD_FLAG}');}catch(e){}d.classList.add(first?'at-preload':'at-hero-go');})();`;

