import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, unwrapSuccessData } from '@/lib/api-client';
import { submitGuestReservationDetails } from '@/lib/capability';
import { encodeStaticReservationState } from '@/lib/static-storefront-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('web API envelope handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('unwraps a valid success envelope', async () => {
    const response = jsonResponse({
      success: true,
      data: { reservationId: 'res_123' },
      request_id: 'req_123',
    });

    await expect(unwrapSuccessData<{ reservationId: string }>(response)).resolves.toEqual({
      reservationId: 'res_123',
    });
  });

  it('rejects a success envelope without request_id', async () => {
    const response = jsonResponse({ success: true, data: { reservationId: 'res_123' } });

    await expect(unwrapSuccessData(response)).rejects.toMatchObject({
      code: 'unknown_error',
      status: 200,
    });
  });

  it('rejects a failure envelope with an unknown error code', async () => {
    const response = jsonResponse(
      {
        success: false,
        error: { code: 'SERVER_CHANGED', message: 'Unexpected failure.' },
        request_id: 'req_123',
      },
      409,
    );

    await expect(unwrapSuccessData(response)).rejects.toMatchObject({
      code: 'unknown_error',
      status: 409,
    });
  });

  it('maps a valid nested failure envelope to ApiError', async () => {
    const response = jsonResponse(
      {
        success: false,
        error: {
          code: 'STATE_CONFLICT',
          message: 'The reservation has already moved on.',
          fields: [{ field: 'status', message: 'must be held' }],
        },
        request_id: 'req_123',
      },
      409,
    );

    const failure = unwrapSuccessData(response);

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      requestId: 'req_123',
      fields: [{ field: 'status', message: 'must be held' }],
    });
  });

  it('keeps guest detail submission fully local during the static storefront phase', async () => {
    const reservationId = encodeStaticReservationState({
      storeSlug: 'luxe-rentals',
      itemId: 'emerald-evening-gown',
      size: 'M',
      pickupDate: '2026-10-10',
      returnDate: '2026-10-13',
      status: 'held',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await submitGuestReservationDetails(
      reservationId,
      {
        fullName: 'Ava Cruz',
        phone: '09171234567',
        email: 'ava@example.com',
        pickupMethod: 'self_pickup',
        paymentMethod: 'cash',
      },
      'idem_12345678',
    );

    expect(result.summary.customer.fullName).toBe('Ava Cruz');
    expect(result.summary.payment.method).toBe('cash');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid static reservation id without contacting a backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      submitGuestReservationDetails(
        'not-a-static-reservation',
        {
          fullName: 'Ava Cruz',
          phone: '09171234567',
          email: 'ava@example.com',
          pickupMethod: 'self_pickup',
          paymentMethod: 'cash',
        },
        'idem_12345678',
      ),
    ).rejects.toThrow(/static reservation preview/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
