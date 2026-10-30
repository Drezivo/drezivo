import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuestReservationView } from '@drezivo/contracts';

import { PaymentStep } from '@/components/store/booking/payment-step';

vi.mock('@/lib/receipt-upload', () => ({ receiptProblem: vi.fn(() => null), uploadReceipt: vi.fn() }));
const originalCreateObjectUrl = URL.createObjectURL;

const reservation = {
  id: '11111111-1111-4111-8111-111111111111',
  reference_code: 'RSV-TEST',
  status: 'held',
  item_name: 'Rosalie',
  size_label: 'M',
  fulfillment_method: 'pickup',
  pickup_at: '2026-10-15T02:00:00.000Z',
  due_at: '2026-10-18T02:00:00.000Z',
  hold_expires_at: '2026-10-15T02:15:00.000Z',
  receipt_submitted: false,
  money: { rental_total_minor: '50000', security_required_minor: '50000', delivery_total_minor: '0', due_now_minor: '100000' },
  payment_instructions: {
    method_name: 'GCash',
    rail: 'manual_qr',
    destination_note: 'Account name: Luna Rentals',
    renter_steps: { text: 'Send the exact amount, then share your receipt.' },
  },
} as GuestReservationView;

describe('storefront payment renter steps', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/grant')) {
        return new Response(JSON.stringify({ success: true, data: { media_grant: 'scoped-grant' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(new Blob(['image']), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:https://api.example.test/steps') });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
  });

  it('shows the shared reservation steps once alongside the selected payment method', () => {
    render(<PaymentStep reservation={reservation} onSubmitted={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Pay with GCash' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Steps for renters' })).toBeVisible();
    expect(screen.getByText('Send the exact amount, then share your receipt.')).toBeVisible();
    expect(screen.getAllByRole('heading', { name: 'Steps for renters' })).toHaveLength(1);
  });

  it('shows the shared image when the tenant chose image steps', async () => {
    render(<PaymentStep
      reservation={{
        ...reservation,
        payment_instructions: {
          ...reservation.payment_instructions,
          renter_steps: { text: null, image_url: 'https://api.example.test/api/v1/guest/reservations/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222', image_content_type: 'image/png' },
        },
      } as GuestReservationView}
      onSubmitted={vi.fn()}
    />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('img', { name: 'Steps for renters' })).toHaveAttribute('src', 'blob:https://api.example.test/steps');
    expect(screen.getAllByRole('heading', { name: 'Steps for renters' })).toHaveLength(1);
  });
});
