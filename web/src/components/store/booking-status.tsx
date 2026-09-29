'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { GuestReservationView, PublicStorefront } from '@drezivo/contracts';

import { getGuestReservation, StorefrontApiError } from '@/lib/storefront-api';
import { formatInstant } from '@/lib/storefront-format';

import { MoneyBreakdown, PaymentStep } from './booking/payment-step';

const STATUS: Record<GuestReservationView['status'], { title: string; body: string }> = {
  held: { title: 'Waiting for your payment', body: 'Your size is held. Pay and upload the receipt before the timer ends.' },
  pending_confirmation: { title: 'Request received', body: 'The shop is reviewing your request and receipt. Your size stays held meanwhile.' },
  confirmed: { title: 'Confirmed', body: 'Your rental is confirmed. See you on your pickup date.' },
  picked_up: { title: 'Picked up', body: 'Enjoy your event. Remember your return date.' },
  returned: { title: 'Returned', body: 'Thank you. The shop is checking the piece before your deposit is settled.' },
  completed: { title: 'Completed', body: 'This rental is complete. Thank you for renting.' },
  cancelled: { title: 'Cancelled', body: 'This rental was cancelled. The shop will contact you about any refund.' },
  rejected: { title: 'Declined', body: 'The shop could not accept this request. They will contact you about any payment you sent.' },
  expired: { title: 'Hold ended', body: 'The hold ended before a receipt arrived. You can choose your dates again.' },
};

/**
 * The guest link is /s/<slug>/booking#<id>.<token>. The fragment never reaches any server or a
 * Referer header; the token is sent only as a Bearer header to the API.
 */
export function BookingStatus({ store }: { store: PublicStorefront }) {
  const [access, setAccess] = useState<{ id: string; token: string } | null>(null);
  const [view, setView] = useState<GuestReservationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const match = /^#([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(window.location.hash);
    if (!match?.[1] || !match[2]) {
      setError('This link is incomplete. Open the link from your email again.');
      return;
    }
    const next = { id: match[1], token: match[2] };
    setAccess(next);
    getGuestReservation(next.id, next.token)
      .then(setView)
      .catch((caught: unknown) => setError(caught instanceof StorefrontApiError ? caught.message : 'Could not load this request.'));
  }, []);

  if (error) {
    return (
      <div className="max-w-xl">
        <p className="font-sf-display text-3xl font-light">We could not open this request</p>
        <p className="mt-3 text-sf-muted">{error}</p>
        <Link href={`/s/${store.slug}`} className="sf-button sf-button-outline mt-6">
          Back to the shop
        </Link>
      </div>
    );
  }
  if (!view || !access) return <p className="text-sf-muted" role="status">Loading your request…</p>;

  const status = STATUS[view.status];
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div>
        <p className="text-sm text-sf-muted">Reference {view.reference_code.slice(0, 12)}</p>
        <h1 className="mt-2 font-sf-display text-5xl font-light">{status.title}</h1>
        <p className="mt-4 max-w-xl text-sf-muted">{status.body}</p>
        <dl className="mt-8 space-y-3 border-y border-sf-line py-6 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-sf-muted">Item</dt>
            <dd>
              {view.item_name}
              {view.size_label ? ` · ${view.size_label}` : ''}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sf-muted">Pickup</dt>
            <dd>{formatInstant(view.pickup_at, store.timezone)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sf-muted">Return</dt>
            <dd>{formatInstant(view.due_at, store.timezone)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sf-muted">{view.fulfillment_method === 'delivery' ? 'Delivery' : 'Pickup at'}</dt>
            <dd className="text-right">{view.fulfillment_method === 'delivery' ? 'To your address' : (store.contact.address ?? store.name)}</dd>
          </div>
        </dl>
        <div className="mt-6 max-w-sm">
          <MoneyBreakdown reservation={view} />
        </div>
      </div>
      <aside>
        {view.status === 'held' && !view.receipt_submitted ? (
          <PaymentStep reservation={view} token={access.token} onSubmitted={setView} />
        ) : (
          <div className="border border-sf-line p-6 text-sm text-sf-muted">
            Questions about this request? Contact {store.name}
            {store.contact.phone ? ` at ${store.contact.phone}` : ''}
            {store.contact.email ? ` or ${store.contact.email}` : ''}.
          </div>
        )}
      </aside>
    </div>
  );
}
