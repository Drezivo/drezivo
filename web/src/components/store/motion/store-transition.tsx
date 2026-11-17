'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Show feedback for slow storefront navigation without intercepting the link. */
export function StoreTransition({ slug }: { slug: string }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (timeout.current !== null) clearTimeout(timeout.current);
      timer.current = null;
      timeout.current = null;
      setVisible(false);
    };
    clear();
    return clear;
  }, [pathname]);

  useEffect(() => {
    const base = `/s/${slug}`;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) || url.pathname.startsWith(`${base}/preview`) || url.pathname === window.location.pathname) return;
      if (timer.current !== null) clearTimeout(timer.current);
      if (timeout.current !== null) clearTimeout(timeout.current);
      timer.current = setTimeout(() => setVisible(true), 150);
      timeout.current = setTimeout(() => setVisible(false), 8000);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [slug]);

  return visible ? <div role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 bg-sf-accent"><span className="sr-only">Loading page</span></div> : null;
}
