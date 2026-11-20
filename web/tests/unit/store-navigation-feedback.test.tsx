import { act, fireEvent, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { createElement, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/s/test-shop' }));
const animation = vi.hoisted(() => ({ timer: null as ReturnType<typeof setTimeout> | null }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props, children) }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('gsap', () => ({ default: {
  fromTo: vi.fn(),
  set: vi.fn(),
  to: (_tiles: unknown, options: { onComplete: () => void }) => { animation.timer = setTimeout(options.onComplete, 500); },
  killTweensOf: () => { if (animation.timer !== null) clearTimeout(animation.timer); animation.timer = null; },
} }));

import { StoreTransition } from '@/components/store/motion/store-transition';

describe('storefront navigation feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    navigation.pathname = '/s/test-shop';
    window.history.replaceState(null, '', '/s/test-shop');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('shows the mosaic immediately without blocking navigation', () => {
    render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const link = screen.getByRole('link', { name: 'Collection' });
    let blockedAtTarget = true;
    link.addEventListener('click', (event) => { blockedAtTarget = event.defaultPrevented; event.preventDefault(); }, { once: true });
    act(() => { link.dispatchEvent(click); });
    expect(blockedAtTarget).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('Loading page');
    expect(screen.getByRole('status').querySelectorAll('.sf-mosaic-tile')).toHaveLength(96);
  });

  it('keeps the mosaic visible for at least 1.2 seconds after a fast arrival', () => {
    const { rerender } = render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const link = screen.getByRole('link', { name: 'Collection' });
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    navigation.pathname = '/s/test-shop/catalog';
    rerender(<StoreTransition slug="test-shop" />);
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears the mosaic if navigation never completes', () => {
    render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const link = screen.getByRole('link', { name: 'Collection' });
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    act(() => vi.advanceTimersByTime(8000));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the mosaic on history navigation to another storefront page', () => {
    const { rerender } = render(<StoreTransition slug="test-shop" />);
    window.history.replaceState(null, '', '/s/test-shop/catalog');
    fireEvent.popState(window);
    expect(screen.getByRole('status')).toBeTruthy();
    navigation.pathname = '/s/test-shop/catalog';
    rerender(<StoreTransition slug="test-shop" />);
    act(() => vi.advanceTimersByTime(1200));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses a static overlay for reduced motion and clears it after the minimum', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const { rerender } = render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const link = screen.getByRole('link', { name: 'Collection' });
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(screen.getByRole('status')).toBeTruthy();
    navigation.pathname = '/s/test-shop/catalog';
    rerender(<StoreTransition slug="test-shop" />);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not show the mosaic for same-page links or cancelled clicks', () => {
    render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop#about">About</Link><Link href="/s/test-shop/catalog">Collection</Link></>);
    fireEvent.click(screen.getByRole('link', { name: 'About' }));
    const cancel = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('click', cancel, { capture: true, once: true });
    fireEvent.click(screen.getByRole('link', { name: 'Collection' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
