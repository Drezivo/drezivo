import type Lenis from 'lenis';

let lenis: Lenis | null = null;
let locks = 0;
let afterUnlock: Array<() => void> = [];

/** Called by MotionRoot; `null` when smooth scrolling is off (reduced motion, unmount). */
export function registerLenis(instance: Lenis | null): void {
  lenis = instance;
  if (instance && locks > 0) instance.stop();
}

/**
 * Freezes the page behind a modal (menu, booking drawer) and returns the release. Reference
 * counted, so closing one overlay cannot unlock the page while another is still open, and it
 * pauses smooth scrolling, which ignores `overflow: hidden` on its own.
 */
export function lockPageScroll(): () => void {
  locks += 1;
  document.body.style.overflow = 'hidden';
  lenis?.stop();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks > 0) return;
    document.body.style.overflow = '';
    lenis?.start();
    const queued = afterUnlock;
    afterUnlock = [];
    queued.forEach((run) => run());
  };
}

/** Runs now, or as soon as the last open overlay releases the page (a scroll while locked is lost). */
export function whenScrollUnlocked(run: () => void): void {
  if (locks === 0) run();
  else afterUnlock.push(run);
}

/**
 * Brings a section just below the sticky header. The offset comes from the section's CSS
 * `scroll-margin-top` (globals.css), which both smooth scrolling and the browser honour, so there is
 * one source of truth. With smooth scrolling on it is a short, fast glide; `immediate` jumps, which
 * also cancels any glide still running from an earlier scroll.
 */
export function scrollToSection(target: HTMLElement, { immediate = false } = {}): void {
  if (lenis) {
    // After a page change the previous page's height may still be cached, which would cap the jump.
    lenis.resize();
    lenis.scrollTo(target, { immediate, duration: 0.7, easing: (t) => 1 - Math.pow(1 - t, 4), force: true });
    return;
  }
  target.scrollIntoView({ block: 'start' });
}

/** Makes smooth scrolling agree with wherever the browser or router just put the page. */
export function syncScrollPosition(): void {
  if (!lenis) return;
  lenis.resize();
  lenis.scrollTo(window.scrollY, { immediate: true, force: true });
}
