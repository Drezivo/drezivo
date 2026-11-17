import { act, fireEvent, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { createElement, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/s/test-shop' }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props, children) }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

import { StoreTransition } from '@/components/store/motion/store-transition';

describe('storefront navigation feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.pathname = '/s/test-shop';
    window.history.replaceState(null, '', '/s/test-shop');
  });
  afterEach(() => vi.useRealTimers());

  it('does not block navigation and only shows the indicator after a delay', () => {
    render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const link = screen.getByRole('link', { name: 'Collection' });
    let blockedAtTarget = true;
    link.addEventListener('click', (event) => { blockedAtTarget = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(click);
    expect(blockedAtTarget).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole('status').textContent).toContain('Loading page');
  });

  it('clears the indicator when the destination arrives', () => {
    const { rerender } = render(<><StoreTransition slug="test-shop" /><Link href="/s/test-shop/catalog">Collection</Link></>);
    const link = screen.getByRole('link', { name: 'Collection' });
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    act(() => vi.advanceTimersByTime(150));
    navigation.pathname = '/s/test-shop/catalog';
    rerender(<StoreTransition slug="test-shop" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
