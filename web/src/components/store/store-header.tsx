'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { PublicStorefront } from '@drezivo/contracts';

import { lockPageScroll } from './motion/scroll';
import { storeNav } from './store-nav';

export function StoreHeader({ store }: { store: PublicStorefront }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nav = storeNav(store);
  const home = `/s/${store.slug}`;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const unlock = lockPageScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open]);

  return (
    <>
      {store.content.announcement ? (
        <p className="bg-sf-accent px-4 py-2 text-center text-xs tracking-wide text-sf-accent-ink">{store.content.announcement}</p>
      ) : null}
      <header data-store-header className="sticky top-0 z-30 border-b border-sf-line bg-sf-bg/95 backdrop-blur supports-[backdrop-filter]:bg-sf-bg/85">
        <div className="mx-auto flex h-[var(--storefront-header-height)] max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link href={home} className="flex min-w-0 items-center gap-3" aria-label={`${store.name} home`}>
            {store.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the API
              <img src={store.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : null}
            <span className="truncate font-sf-display text-xl font-normal tracking-tight sm:text-2xl">{store.name}</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className="text-sm text-sf-muted transition-colors hover:text-sf-ink aria-[current=page]:text-sf-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* Phones get "Browse the collection" in the menu; .sf-button's display would beat `hidden`. */}
            <span className="hidden sm:block">
              <Link href={`${home}/catalog`} className="sf-button sf-button-outline">
                Reserve
              </Link>
            </span>
            <button
              ref={menuButton}
              type="button"
              className="-mr-2 flex h-11 w-11 items-center justify-center lg:hidden"
              aria-expanded={open}
              aria-controls="store-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((value) => !value)}
            >
              <span aria-hidden="true" className="relative block h-3 w-6">
                <span className={`absolute left-0 h-px w-6 bg-current transition-transform ${open ? 'top-1.5 rotate-45' : 'top-0'}`} />
                <span className={`absolute left-0 h-px w-6 bg-current transition-transform ${open ? 'top-1.5 -rotate-45' : 'top-3'}`} />
              </span>
            </button>
          </div>
        </div>
      </header>

      {open ? (
        <div id="store-menu" className="fixed inset-x-0 bottom-0 top-[var(--storefront-header-height)] z-20 bg-sf-bg px-5 pb-10 pt-6 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <nav aria-label="Mobile" className="flex flex-col">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="border-b border-sf-line py-4 font-sf-display text-3xl font-light">
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href={`${home}/catalog`} onClick={() => setOpen(false)} className="sf-button sf-button-primary mt-8 w-full">
            Browse the collection
          </Link>
        </div>
      ) : null}
    </>
  );
}
