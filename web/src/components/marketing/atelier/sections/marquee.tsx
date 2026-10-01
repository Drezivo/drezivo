'use client';

import { useEffect, useRef } from 'react';

import { motionAllowed } from '../motion/motion-tokens';

const SHOPS = ['Bridal gowns', 'Debut gowns', 'Filipiniana', 'Barong Tagalog', 'Ternos', 'Evening dresses', 'Suits and tuxedos', 'Costumes', 'Prom and graduation', 'Cosplay'];

/**
 * The kinds of shops Drezivo is built for, drifting past. Speed is set from the track's width so it
 * stays constant whatever the screen; linear easing, because any other curve visibly lurches.
 */
export function ShopMarquee() {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = track.current;
    if (!element || !motionAllowed()) return;
    const animation = element.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }], {
      duration: element.scrollWidth * 14,
      iterations: Infinity,
      easing: 'linear',
    });
    return () => animation.cancel();
  }, []);

  const items = [...SHOPS, ...SHOPS];
  return (
    <section aria-label="Shops Drezivo is built for" data-header="dark" className="overflow-hidden border-y border-atelier-night-line bg-atelier-night py-7 text-atelier-paper">
      <div ref={track} className="flex w-max items-center">
        {items.map((shop, index) => (
          <span key={`${shop}-${index}`} aria-hidden={index >= SHOPS.length} className="flex items-center whitespace-nowrap font-[family-name:var(--font-atelier-display)] text-[clamp(1.5rem,2.6vw,2.25rem)] italic">
            <span className="px-8">{shop}</span>
            <span aria-hidden="true" className="text-[0.6em] not-italic text-atelier-champagne">✦</span>
          </span>
        ))}
      </div>
    </section>
  );
}
