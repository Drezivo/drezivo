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

/** Jumps to the top without smoothing, for page changes. */
export function resetScroll(): void {
  if (lenisInstance) lenisInstance.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
}

export function lockScroll(locked: boolean): void {
  if (!lenisInstance) {
    document.documentElement.style.overflow = locked ? 'hidden' : '';
    return;
  }
  if (locked) lenisInstance.stop();
  else lenisInstance.start();
}
