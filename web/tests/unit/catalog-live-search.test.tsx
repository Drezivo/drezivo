import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/s/test-shop/catalog',
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { CatalogControls } from '@/components/store/catalog-controls';

describe('catalogue live search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.search = 'size=M&page=3';
    navigation.push.mockReset();
    navigation.replace.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('debounces typing and preserves filters while resetting the page', () => {
    render(<CatalogControls categories={[]} sizes={['M']} subcategories={[]} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'd' } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(input, { target: { value: 'dress' } });
    act(() => vi.advanceTimersByTime(399));
    expect(navigation.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(navigation.replace).toHaveBeenCalledWith('/s/test-shop/catalog?size=M&search=dress', { scroll: false });
  });

  it('submits immediately on Enter and does not submit again after the timer', () => {
    render(<CatalogControls categories={[]} sizes={['M']} subcategories={[]} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'silk' } });
    fireEvent.submit(screen.getByRole('search'));
    act(() => vi.advanceTimersByTime(400));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('/s/test-shop/catalog?size=M&search=silk', { scroll: false });
  });

  it('restores the search from browser history and cancels pending typing', () => {
    window.history.replaceState(null, '', '/s/test-shop/catalog?search=old');
    navigation.search = 'search=old';
    render(<CatalogControls categories={[]} sizes={[]} subcategories={[]} />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new' } });
    window.history.replaceState(null, '', '/s/test-shop/catalog?search=older');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    act(() => vi.advanceTimersByTime(400));
    expect(input.value).toBe('older');
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('keeps new typing when an earlier navigation completes', () => {
    const { rerender } = render(<CatalogControls categories={[]} sizes={['M']} subcategories={[]} />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'silk' } });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: 'silky' } });
    navigation.search = 'size=M&search=silk';
    rerender(<CatalogControls categories={[]} sizes={['M']} subcategories={[]} />);
    expect(input.value).toBe('silky');
    act(() => vi.advanceTimersByTime(400));
    expect(navigation.replace).toHaveBeenLastCalledWith('/s/test-shop/catalog?size=M&search=silky', { scroll: false });
  });
});
