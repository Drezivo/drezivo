'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { EASE_DRAMA, EASE_REVEAL, motionAllowed, setLenis } from './motion-tokens';

gsap.registerPlugin(ScrollTrigger);

/**
 * Every marketing-page animation, bound from data attributes so pages stay server-rendered:
 *
 * - `data-at-reveal="up"`     fades in from 48px below when it scrolls into view.
 * - `data-at-reveal="blur"`   arrives out of a 12px blur (images, product mockups).
 * - `data-at-reveal="lines"`  each `[data-at-line]` child rises out of its overflow mask (headlines).
 * - `data-at-stagger` > `data-at-item`  children arrive 80ms apart.
 *
 * Hidden start states live in CSS under `html.at-motion`, which an inline script adds before first
 * paint only when motion is allowed. Without it, or without JavaScript, everything is visible, and
 * anything this component never binds reveals itself via a CSS fallback (`data-at-bound`).
 */
export function MarketingMotion() {
  const pathname = usePathname();

  useEffect(() => {
    if (!motionAllowed()) return;
    const lenis = new Lenis({
      lerp: 0.085,
      autoRaf: false,
      anchors: { offset: -72 },
      prevent: (node) => node.closest('[role="dialog"], [data-lenis-prevent]') !== null,
    });
    const tick = (time: number) => lenis.raf(time * 1000);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    setLenis(lenis);
    return () => {
      setLenis(null);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  // Rebind on every page: new DOM after a client navigation needs its own triggers.
  useEffect(() => {
    if (!motionAllowed()) return;
    const context = gsap.context(() => {
      const bind = (element: Element) => element.setAttribute('data-at-bound', '');

      gsap.utils.toArray<HTMLElement>('[data-at-reveal="lines"]').forEach((block) => {
        bind(block);
        gsap.to(block.querySelectorAll('[data-at-line]'), {
          y: 0,
          duration: 1.3,
          ease: EASE_DRAMA,
          stagger: 0.12,
          scrollTrigger: { trigger: block, start: 'top 85%', once: true },
        });
      });

      ScrollTrigger.batch('[data-at-reveal="up"]', {
        start: 'top 88%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE_REVEAL, stagger: 0.08 }),
      });
      gsap.utils.toArray<HTMLElement>('[data-at-reveal="up"]').forEach(bind);

      ScrollTrigger.batch('[data-at-reveal="blur"]', {
        start: 'top 85%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { autoAlpha: 1, filter: 'blur(0px)', scale: 1, duration: 1.1, ease: EASE_REVEAL, stagger: 0.1 }),
      });
      gsap.utils.toArray<HTMLElement>('[data-at-reveal="blur"]').forEach(bind);

      gsap.utils.toArray<HTMLElement>('[data-at-stagger]').forEach((group) => {
        bind(group);
        gsap.to(group.querySelectorAll('[data-at-item]'), {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: EASE_REVEAL,
          stagger: 0.08,
          scrollTrigger: { trigger: group, start: 'top 85%', once: true },
        });
      });
    });
    // Late layout (fonts, images, the hero canvas) moves trigger positions; measure again.
    const refresh = window.setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => {
      window.clearTimeout(refresh);
      context.revert();
    };
  }, [pathname]);

  return null;
}
