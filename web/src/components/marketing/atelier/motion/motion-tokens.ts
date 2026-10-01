import type Lenis from 'lenis';

/**
 * The marketing site's motion vocabulary. Three curves only: UI for hovers and small state changes,
 * REVEAL for scroll entrances, DRAMA for the hero, the preloader and page transitions.
 */
export const EASE_UI = 'power1.inOut';
export const EASE_REVEAL = 'expo.out';
export const EASE_DRAMA = 'power4.inOut';

export const CSS_EASE_UI = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let lenisInstance: Lenis | null = null;

export function setLenis(lenis: Lenis | null): void {
  lenisInstance = lenis;
}

/**
 * Places a newly arrived page without smoothing: at its `#hash` section when the link had one
 * (offset by that section's scroll-margin-top), otherwise at the top.
 */
export function resetScroll(hash = ''): void {
  const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  if (lenisInstance) {
    // Lenis still holds the previous page's scroll limit until it re-measures; without this a
    // section lower than the old page's height is clamped short.
    lenisInstance.resize();
    lenisInstance.scrollTo(target ?? 0, { immediate: true, force: true });
  } else if (target) {
    target.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

export function lockScroll(locked: boolean): void {
  if (!lenisInstance) {
    document.documentElement.style.overflow = locked ? 'hidden' : '';
    return;
  }
  if (locked) lenisInstance.stop();
  else lenisInstance.start();
}
