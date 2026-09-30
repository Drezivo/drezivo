'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { registerLenis } from './scroll';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const EASE = 'power3.out';
const UNVEIL = 'expo.out';

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * All storefront motion in one place. Pages stay server-rendered and only carry data attributes:
 *
 * - `data-hero` with `data-hero-media`, `data-hero-line`, `data-hero-fade`, `data-hero-content`:
 *   the one orchestrated moment. The photo settles, the heading rises out of its mask, and the
 *   content fades away as the visitor scrolls past it.
 * - `data-reveal="text"`: eases in once when it scrolls into view.
 * - `data-reveal="image"`: the frame unveils while the photo settles.
 * - `data-reveal-group` > `data-reveal-item`: items arrive in small staggered batches.
 * - `data-store-header`: slides away while scrolling down, returns on the way up.
 *
 * Initial hidden states come from CSS under `html.sf-motion`, which an inline script sets before
 * first paint only when the visitor has not asked for reduced motion. Without it, or without
 * JavaScript, everything is simply visible.
 */
export function MotionRoot() {
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (reducedMotion()) return;
    const headerHeight = document.querySelector<HTMLElement>('[data-store-header]')?.offsetHeight ?? 0;
    const lenis = new Lenis({
      lerp: 0.09,
      autoRaf: false,
      anchors: { offset: -headerHeight },
      // Overlays and horizontal strips scroll natively.
      prevent: (node) => node.closest('[role="dialog"], [data-lenis-prevent]') !== null,
    });
    const tick = (time: number) => lenis.raf(time * 1000);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    registerLenis(lenis);
    return () => {
      registerLenis(null);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  useGSAP(
    () => {
      if (reducedMotion()) return;
      document.documentElement.classList.add('sf-motion-ready');

      if (pathname !== firstPath.current) {
        gsap.fromTo('#main', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: 'power2.out', clearProps: 'opacity,visibility' });
      }

      const hero = document.querySelector<HTMLElement>('[data-hero]');
      if (hero) {
        const media = hero.querySelector('[data-hero-media]');
        const content = hero.querySelector('[data-hero-content]');
        const intro = gsap.timeline({ defaults: { ease: EASE } });
        if (media) intro.fromTo(media, { scale: 1.12 }, { scale: 1, duration: 1.8, ease: UNVEIL }, 0);
        intro
          // `y: 0` discards the CSS starting offset, which GSAP would otherwise keep as pixels.
          .fromTo(hero.querySelectorAll('[data-hero-line]'), { y: 0, yPercent: 105 }, { y: 0, yPercent: 0, duration: 1.2, stagger: 0.08 }, 0.15)
          .fromTo(hero.querySelectorAll('[data-hero-fade]'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.1 }, 0.5);
        const scrub = { trigger: hero, start: 'top top', end: 'bottom top', scrub: true };
        if (media) gsap.to(media, { yPercent: 12, ease: 'none', scrollTrigger: scrub });
        if (content) gsap.to(content, { autoAlpha: 0, y: -48, ease: 'none', scrollTrigger: { ...scrub, end: 'bottom 30%' } });
      }

      gsap.utils.toArray<HTMLElement>('[data-reveal="text"]').forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: 28 },
          { autoAlpha: 1, y: 0, duration: 1, ease: EASE, scrollTrigger: { trigger: element, start: 'top 88%', once: true } },
        );
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal="image"]').forEach((frame) => {
        const timeline = gsap.timeline({ scrollTrigger: { trigger: frame, start: 'top 85%', once: true } });
        timeline.fromTo(frame, { clipPath: 'inset(10% 6% 10% 6%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: UNVEIL }, 0);
        const image = frame.querySelector('img');
        if (image) timeline.fromTo(image, { scale: 1.15 }, { scale: 1, duration: 1.6, ease: UNVEIL }, 0);
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal-group]').forEach((group) => {
        const items = group.querySelectorAll<HTMLElement>('[data-reveal-item]');
        gsap.set(items, { autoAlpha: 0, y: 32 });
        ScrollTrigger.batch(items, {
          start: 'top 92%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.08, overwrite: true }),
        });
      });

      const header = document.querySelector<HTMLElement>('[data-store-header]');
      if (!header) return;
      ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: (self) => header.classList.toggle('is-tucked', self.direction === 1 && self.scroll() > 160),
      });
      return () => header.classList.remove('is-tucked');
    },
    { dependencies: [pathname], revertOnUpdate: true },
  );

  return null;
}
