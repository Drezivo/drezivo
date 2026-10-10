import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuestReservationView, PublicStorefront } from '@drezivo/contracts';

const { getGuestReservation, transitionPush } = vi.hoisted(() => ({
  getGuestReservation: vi.fn(),
  transitionPush: vi.fn(),
}));
vi.mock('@/lib/storefront-api', () => ({
  getGuestReservation,
  StorefrontApiError: class StorefrontApiError extends Error {},
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/s/test-shop/booking',
  useRouter: () => ({ push: transitionPush }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('gsap', () => ({
  default: {
    killTweensOf: () => undefined,
    fromTo: () => undefined,
    to: () => undefined,
  },
}));

import { BookingStatus } from '@/components/store/booking-status';
import { StoreFooter } from '@/components/store/store-footer';
import { StoreHeader } from '@/components/store/store-header';
import { StoreTransition } from '@/components/store/motion/store-transition';

const store = {
  slug: 'test-shop',
  name: 'Test Shop',
  timezone: 'Asia/Manila',
  logo_url: null,
  description: null,
  contact: { address: '1 Test Street', phone: null, email: null, instagram_url: null, facebook_url: null, tiktok_url: null },
  content: { announcement: null, sections: { about: false }, about: { body: null } },
  fitting: { enabled: false },
} as unknown as PublicStorefront;

const reservation = {
  id: 'f6a273de-f2df-4522-bb48-1d05b9e01423',
  reference_code: 'RSV-1234',
  status: 'pending_confirmation',
  item_name: 'Emerald Gown',
  size_label: 'M',
  pickup_at: '2026-10-06T02:00:00.000Z',
  due_at: '2026-10-09T02:00:00.000Z',
  fulfillment_method: 'pickup',
  receipt_submitted: true,
  hold_expires_at: null,
  payment_instructions: null,
  money: {
    rental_total_minor: '30000',
    security_required_minor: '50000',
    delivery_total_minor: '0',
    due_now_minor: '80000',
  },
} as unknown as GuestReservationView;

function dispatchAndObserveClick(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
  let defaultPreventedAtTarget = false;
  anchor.addEventListener(
    'click',
    (dispatchedEvent) => {
      defaultPreventedAtTarget = dispatchedEvent.defaultPrevented;
      dispatchedEvent.preventDefault();
    },
    { once: true },
  );
  anchor.dispatchEvent(event);
  return defaultPreventedAtTarget;
}

describe('reservation proof page', () => {
  beforeEach(() => {
    getGuestReservation.mockReset();
    getGuestReservation.mockResolvedValue(reservation);
    transitionPush.mockReset();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    window.history.replaceState(null, '', '/s/test-shop/booking?reservation=f6a273de-f2df-4522-bb48-1d05b9e01423');
  });

  afterEach(() => {
    document.body.querySelector('[data-test-proof-exit]')?.remove();
    vi.unstubAllGlobals();
  });

  function renderProofWithNavigation() {
    return render(
      <>
        <StoreTransition slug={store.slug} />
        <StoreHeader store={store} />
        <BookingStatus store={store} reservationId={reservation.id} />
        <StoreFooter store={store} />
      </>,
    );
  }

  it('shows reservation proof and asks for a screenshot before leaving', async () => {
    render(<BookingStatus store={store} reservationId={reservation.id} />);

    expect(await screen.findByText('Screenshot this page before leaving.')).not.toBeNull();
    expect(screen.getByText(/RSV-1234/)).not.toBeNull();
    expect(screen.getByText('Item').parentElement?.textContent).toContain('Emerald Gown · M');
    expect(screen.getByText('Request received')).not.toBeNull();
    expect(screen.getByText(/We do not email reservation confirmations or receipts/)).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for confirmation when navigating away and allows the customer to keep viewing', async () => {
    render(<BookingStatus store={store} reservationId={reservation.id} />);
    await screen.findByText('Screenshot this page before leaving.');

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    const link = document.createElement('a');
    link.href = '/s/test-shop';
    link.textContent = 'Leave proof page';
    link.dataset.testProofExit = 'true';
    document.body.append(link);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep viewing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('guards header navigation before the animated storefront transition can navigate', async () => {
    renderProofWithNavigation();
    await screen.findByText('Screenshot this page before leaving.');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Collection' }));

    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    expect(transitionPush).not.toHaveBeenCalled();
  });

  it('guards footer navigation before the animated storefront transition can navigate', async () => {
    renderProofWithNavigation();
    await screen.findByText('Screenshot this page before leaving.');

    fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Collection' }));

    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    expect(transitionPush).not.toHaveBeenCalled();
  });

  it('still guards navigation when reduced motion disables the transition', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    renderProofWithNavigation();
    await screen.findByText('Screenshot this page before leaving.');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Collection' }));

    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    expect(transitionPush).not.toHaveBeenCalled();
  });

  it('guards Contact hash navigation and keeps the proof guard armed after confirming the jump', async () => {
    renderProofWithNavigation();
    await screen.findByText('Screenshot this page before leaving.');

    const contactSection = screen.getByRole('contentinfo');
    contactSection.scrollIntoView = vi.fn();
    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Contact' }));
    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I saved it — leave' }));

    await waitFor(() => expect(window.location.hash).toBe('#contact'));
    expect(contactSection.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Rental info' }));
    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
  });

  it('allows a real same-tab navigation after the visitor confirms', async () => {
    renderProofWithNavigation();
    await screen.findByText('Screenshot this page before leaving.');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Collection' }));
    expect(await screen.findByRole('dialog', { name: 'Done screenshot?' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I saved it — leave' }));

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it('does not guard modified, new-tab, or download clicks', async () => {
    render(<BookingStatus store={store} reservationId={reservation.id} />);
    await screen.findByText('Screenshot this page before leaving.');

    const modifiedLink = document.createElement('a');
    modifiedLink.href = '/s/test-shop/catalog';
    document.body.append(modifiedLink);
    const modifiedClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    const modifiedPreventedAtTarget = dispatchAndObserveClick(modifiedLink, modifiedClick);

    const newTabLink = document.createElement('a');
    newTabLink.href = '/s/test-shop/catalog';
    newTabLink.target = '_blank';
    document.body.append(newTabLink);
    const newTabClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const newTabPreventedAtTarget = dispatchAndObserveClick(newTabLink, newTabClick);

    const downloadLink = document.createElement('a');
    downloadLink.href = '/proof.png';
    downloadLink.download = 'proof.png';
    document.body.append(downloadLink);
    const downloadClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const downloadPreventedAtTarget = dispatchAndObserveClick(downloadLink, downloadClick);

    expect(modifiedPreventedAtTarget).toBe(false);
    expect(newTabPreventedAtTarget).toBe(false);
    expect(downloadPreventedAtTarget).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    modifiedLink.remove();
    newTabLink.remove();
    downloadLink.remove();
  });
});
