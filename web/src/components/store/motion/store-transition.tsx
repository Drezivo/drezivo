'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

const MIN_VISIBLE_MS = 1200;
const MAX_VISIBLE_MS = 8000;
const TILE_COUNT = 96;

/** Show the store's mosaic without delaying or intercepting navigation. */
export function StoreTransition({ slug }: { slug: string }) {
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  const startedAt = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'cover' | 'reveal' | null>(null);

  useEffect(() => {
    if (pathname === currentPath.current) return;
    currentPath.current = pathname;
    if (startedAt.current === null) return;
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      startedAt.current = null;
      if (fallbackTimer.current !== null) clearTimeout(fallbackTimer.current);
      setPhase('reveal');
    }, remaining);
  }, [pathname]);

  useEffect(() => {
    const base = `/s/${slug}`;
    const isStorePage = (path: string) => (path === base || path.startsWith(`${base}/`)) && !path.startsWith(`${base}/preview`);
    const show = () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      if (fallbackTimer.current !== null) clearTimeout(fallbackTimer.current);
      startedAt.current = Date.now();
      setPhase('cover');
      fallbackTimer.current = setTimeout(() => {
        startedAt.current = null;
        setPhase('reveal');
      }, MAX_VISIBLE_MS);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !isStorePage(url.pathname) || url.pathname === window.location.pathname) return;
      show();
    };
    const onPopState = () => {
      // The booking proof intercepts history navigation to ask for confirmation.
      if (currentPath.current === `${base}/booking`) return;
      if (window.location.pathname !== currentPath.current && isStorePage(window.location.pathname)) show();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      if (fallbackTimer.current !== null) clearTimeout(fallbackTimer.current);
    };
  }, [slug]);

  useEffect(() => {
    const tiles = overlay.current?.querySelectorAll<HTMLElement>('.sf-mosaic-tile');
    if (!tiles || !phase) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (phase === 'cover') gsap.set(tiles, { autoAlpha: 1 });
      else setPhase(null);
      return;
    }
    if (phase === 'cover') {
      gsap.fromTo(tiles, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'none', stagger: { amount: 0.3, from: 'random' } });
    } else {
      gsap.to(tiles, { autoAlpha: 0, duration: 0.2, ease: 'none', stagger: { amount: 0.3, from: 'random' }, onComplete: () => setPhase(null) });
    }
    return () => { gsap.killTweensOf(tiles); };
  }, [phase]);

  if (!phase) return null;
  return (
    <div ref={overlay} className="sf-mosaic" data-active role="status">
      <span className="sr-only">Loading page</span>
      {Array.from({ length: TILE_COUNT }, (_, index) => <span key={index} aria-hidden="true" className="sf-mosaic-tile" />)}
    </div>
  );
}
