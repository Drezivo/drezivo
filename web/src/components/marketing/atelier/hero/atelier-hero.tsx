'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';

import { motionAllowed } from '../motion/motion-tokens';
import type { AtelierScene } from '../scene/atelier-scene';

gsap.registerPlugin(ScrollTrigger);

function markSceneReady() {
  document.documentElement.setAttribute('data-at-scene-ready', '');
  window.dispatchEvent(new Event('at:scene-ready'));
}

function canUseWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Act one: the headline over loose gold ribbons. Act two (as the visitor scrolls): the ribbons wrap
 * the dress form into a gown and the copy changes to "From scattered to settled." The section is
 * twice the viewport tall; its inner frame is sticky, and scroll progress drives the scene.
 */
export function AtelierHero({ signUpUrl, priceLabel, trialDays }: { signUpUrl: string; priceLabel: string; trialDays: number }) {
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // The 3D scene: loaded after first paint, never on the critical path for the headline (LCP).
  useEffect(() => {
    const element = canvas.current;
    const host = section.current;
    if (!element || !host) return;
    if (!canUseWebGL()) {
      markSceneReady();
      return;
    }
    let scene: AtelierScene | null = null;
    let trigger: ScrollTrigger | null = null;
    let cancelled = false;
    const animate = motionAllowed();
    const quality = window.innerWidth >= 1024 && (navigator.hardwareConcurrency ?? 8) > 4 ? 'high' : 'low';

    const onResize = () => {
      const rect = element.getBoundingClientRect();
      scene?.resize(rect.width, rect.height);
    };
    const onPointer = (event: PointerEvent) => {
      scene?.setPointer((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    };

    // Behind a preloader the scene is part of what the counter waits for; otherwise it starts once
    // the browser is idle, so building it never competes with the headline's first paint.
    const preloading = document.documentElement.classList.contains('at-preload');
    const whenIdle = new Promise<void>((resolve) => {
      if (preloading) resolve();
      // Safari has no requestIdleCallback.
      else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 1200 });
      else globalThis.setTimeout(resolve, 600);
    });
    void whenIdle
      .then(() => (cancelled ? Promise.reject(new Error('unmounted')) : import('../scene/atelier-scene')))
      .then(({ createAtelierScene }) => {
        if (cancelled) return;
        scene = createAtelierScene(element, { quality, animate });
        void scene.ready.then(() => {
          if (cancelled) return;
          element.dataset['ready'] = '';
          markSceneReady();
        });
        window.addEventListener('resize', onResize);
        if (animate) {
          window.addEventListener('pointermove', onPointer, { passive: true });
          trigger = ScrollTrigger.create({
            trigger: host,
            start: 'top top',
            end: 'bottom bottom',
            onUpdate: (self) => scene?.setProgress(Math.min(1, self.progress * 1.3)),
          });
        }
      })
      .catch(() => {
        if (!cancelled) markSceneReady();
      });

    return () => {
      cancelled = true;
      trigger?.kill();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      scene?.dispose();
    };
  }, []);

  // The entrance is CSS (html.at-hero-go, see atelier.css) so the headline paints with the first frame
  // instead of waiting for JavaScript. Here, act one hands over to act two as the visitor scrolls.
  useEffect(() => {
    const host = section.current;
    if (!host || !motionAllowed()) return;
    const context = gsap.context(() => {
      gsap
        .timeline({ scrollTrigger: { trigger: host, start: 'top top', end: 'bottom bottom', scrub: 0.6 } })
        .to('[data-hero-act="one"]', { autoAlpha: 0, y: -60, duration: 0.3, ease: 'none' }, 0.22)
        .fromTo('[data-hero-act="two"]', { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'none' }, 0.48)
        .to('[data-hero-cue]', { autoAlpha: 0, duration: 0.1, ease: 'none' }, 0.05);
    }, host);
    return () => context.revert();
  }, []);

  return (
    <section ref={section} id="top" data-header="dark" className="relative h-[175svh] bg-atelier-night text-atelier-paper lg:h-[210svh]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div aria-hidden="true" className="at-hero-poster absolute inset-0" />
        <canvas ref={canvas} data-at-scene aria-hidden="true" className="at-hero-canvas absolute inset-0 h-full w-full" />
        {/* Phones: the copy sits over the lower half of the scene, so it gets a night scrim for contrast. */}
        <div aria-hidden="true" className="at-hero-scrim absolute inset-x-0 bottom-0 h-[62%] lg:hidden" />

        <div className="at-container relative z-10 flex h-full flex-col justify-end-safe pb-[max(2.5rem,8svh)] pt-24 lg:justify-center lg:pb-0 lg:pt-0">
          <div data-hero-act="one" className="max-w-[48rem]">
            <p data-hero-eyebrow className="at-eyebrow text-atelier-champagne">Clothing rental software, made in the Philippines</p>
            <h1 className="mt-4 sm:mt-6 font-[family-name:var(--font-atelier-display)] text-at-hero font-normal">
              {['Every gown.', 'Every booking.', 'One calm place.'].map((line, index) => (
                <span key={line} className="block overflow-hidden whitespace-nowrap pb-[0.08em]">
                  <span data-hero-line className="block" style={{ '--line': index } as React.CSSProperties}>
                    {line}{' '}
                  </span>
                </span>
              ))}
            </h1>
            <p data-hero-fade className="mt-5 max-w-[34rem] sm:mt-7 text-at-lead text-atelier-mist">
              Drezivo runs the busy side of a clothing rental shop: availability, reservations, deposits, payments, and returns.
              Your evenings stop belonging to Messenger.
            </p>
            <div data-hero-fade className="at-cta-row mt-7 sm:mt-9">
              <a href={signUpUrl} className="at-button at-button-light">
                Start your {trialDays}-day free trial
              </a>
              <a href="#before-after" className="at-button at-button-ghost-dark">
                See what changes
              </a>
            </div>
            <p data-hero-fade className="mt-5 text-at-small text-atelier-mist sm:mt-6">
              No credit card. {priceLabel} after your trial.
            </p>
          </div>

          <div data-hero-act="two" className="pointer-events-none absolute inset-x-0 bottom-[max(4rem,10svh)] opacity-0 lg:bottom-auto">
            <div className="at-container">
              <div className="max-w-[30rem]">
                <p className="at-eyebrow text-atelier-champagne">Scattered → settled</p>
                <p className="mt-5 font-[family-name:var(--font-atelier-display)] text-at-display">
                  From scattered threads to one gown.
                </p>
                <p className="mt-5 text-at-lead text-atelier-mist">
                  Messenger threads, notebook calendars, and payment screenshots, gathered into one system your whole team can see.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div data-hero-cue aria-hidden="true" className="at-scroll-cue absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 lg:grid">
          <span className="at-eyebrow text-atelier-mist">Scroll</span>
          <span className="at-scroll-cue-line" />
        </div>
      </div>
    </section>
  );
}
