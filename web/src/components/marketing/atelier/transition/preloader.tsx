'use client';

import gsap from 'gsap';
import Image from 'next/image';
import { useEffect, useRef } from 'react';

import { EASE_DRAMA, EASE_REVEAL } from '../motion/motion-tokens';

const WORD = 'Drezivo';
/** Long enough for the mark to draw; short enough to stay a welcome, not a wait (it delays LCP). */
const MIN_SHOW_MS = 1200;
/** The page reveals by then even if the 3D scene is still building; the scene fades in when ready. */
const MAX_WAIT_MS = 2800;

/**
 * First-visit preloader. The counter follows real readiness, not a timer: fonts (35), the page's
 * own load (70), and — on pages with the 3D hero — the scene's first frame (100). It never blocks
 * longer than MAX_WAIT_MS; the decoration is not worth a stuck page.
 */
export function Preloader({ active, onDone }: { active: boolean; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!active || !element) return;
    const started = performance.now();
    const shown = { value: 0 };
    let target = 0;
    let finished = false;

    // The mark rises into view from the hem up and settles from a bright catch of light.
    const intro = gsap.timeline();
    intro
      .fromTo(
        element.querySelector('[data-mark]'),
        { clipPath: 'inset(100% 0% 0% 0%)', filter: 'brightness(1.7)' },
        { clipPath: 'inset(0% 0% 0% 0%)', filter: 'brightness(1)', duration: 1.4, ease: EASE_DRAMA },
      )
      .to(element.querySelectorAll('[data-word-letter]'), { y: 0, duration: 0.9, ease: EASE_REVEAL, stagger: 0.045 }, 0.35)
      .to(element.querySelectorAll('[data-preload-meta]'), { autoAlpha: 1, duration: 0.6, ease: EASE_REVEAL }, 0.5);

    const advance = (value: number) => {
      target = Math.max(target, value);
      gsap.to(shown, {
        value: target,
        duration: 0.8,
        ease: EASE_REVEAL,
        overwrite: true,
        onUpdate: () => {
          if (counter.current) counter.current.textContent = String(Math.round(shown.value)).padStart(3, '0');
        },
        onComplete: () => {
          if (target >= 100) void exit();
        },
      });
    };

    const exit = async () => {
      if (finished) return;
      finished = true;
      const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - started));
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      await gsap.to(element.querySelectorAll('[data-preload-content]'), { autoAlpha: 0, y: -24, duration: 0.55, ease: EASE_DRAMA });
      onDone();
    };

    advance(12);
    void document.fonts.ready.then(() => advance(35));
    const onLoad = () => advance(70);
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });

    const needsScene = document.querySelector('[data-at-scene]') !== null;
    const onScene = () => advance(100);
    // The scene may finish before this effect runs; it also leaves a mark on <html> for that case.
    if (needsScene && document.documentElement.hasAttribute('data-at-scene-ready')) onScene();
    else if (needsScene) window.addEventListener('at:scene-ready', onScene, { once: true });
    const loaded = () => {
      if (!needsScene) advance(100);
    };
    window.addEventListener('load', loaded, { once: true });
    if (document.readyState === 'complete') loaded();
    const fallback = window.setTimeout(() => advance(100), MAX_WAIT_MS);

    return () => {
      intro.kill();
      window.clearTimeout(fallback);
      window.removeEventListener('load', onLoad);
      window.removeEventListener('load', loaded);
      window.removeEventListener('at:scene-ready', onScene);
    };
  }, [active, onDone]);

  return (
    <div ref={root} className="at-preloader" role="status" aria-live="polite" aria-label="Loading Drezivo">
      <div data-preload-content className="flex flex-col items-center">
        <Image data-mark src="/brand/drezivo-mark.png" alt="" width={497} height={600} priority className="h-28 w-auto sm:h-36" />
        <p className="mt-6 flex overflow-hidden font-[family-name:var(--font-atelier-display)] text-4xl tracking-[0.02em] sm:text-5xl">
          {WORD.split('').map((letter, index) => (
            <span key={`${letter}-${index}`} data-word-letter className="inline-block">
              {letter}
            </span>
          ))}
        </p>
      </div>
      <p data-preload-content data-preload-meta className="at-eyebrow absolute bottom-8 left-6 sm:left-10">
        Clothing rental, in one place
      </p>
      <p data-preload-content data-preload-meta className="absolute bottom-7 right-6 font-[family-name:var(--font-atelier-body)] text-sm tabular-nums tracking-[0.3em] sm:right-10">
        <span ref={counter}>000</span>
      </p>
    </div>
  );
}
