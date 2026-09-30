import type Lenis from 'lenis';

let lenis: Lenis | null = null;
let locks = 0;

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
  };
}
