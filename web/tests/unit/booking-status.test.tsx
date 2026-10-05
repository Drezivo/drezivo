import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuestReservationView, PublicStorefront } from '@drezivo/contracts';

const { getGuestReservation } = vi.hoisted(() => ({ getGuestReservation: vi.fn() }));
vi.mock('@/lib/storefront-api', () => ({
  getGuestReservation,
  StorefrontApiError: class StorefrontApiError extends Error {},
}));

import { BookingStatus } from '@/components/store/booking-status';

const store = {
  slug: 'test-shop',
  name: 'Test Shop',
  timezone: 'Asia/Manila',
  contact: { address: '1 Test Street', phone: null, email: null },
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

describe('reservation proof page', () => {
  beforeEach(() => {
    getGuestReservation.mockReset();
    getGuestReservation.mockResolvedValue(reservation);
    window.history.replaceState(null, '', '/s/test-shop/booking?reservation=f6a273de-f2df-4522-bb48-1d05b9e01423');
  });

  afterEach(() => {
    document.body.querySelector('[data-test-proof-exit]')?.remove();
  });

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
});
