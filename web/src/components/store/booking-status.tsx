'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

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
  cancelled: { title: 'Cancelled', body: 'This rental was cancelled. Contact the shop about any refund.' },
  rejected: { title: 'Declined', body: 'The shop could not accept this request. Contact the shop about any payment you sent.' },
  expired: { title: 'Hold ended', body: 'The hold ended before a receipt arrived. You can choose your dates again.' },
};

type ExitAttempt = { kind: 'history' } | { kind: 'link'; href: string };

/** A private, cookie-authorized reservation proof page. The URL contains only the reservation ID. */
export function BookingStatus({ store, reservationId }: { store: PublicStorefront; reservationId: string }) {
  const [view, setView] = useState<GuestReservationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitAttempt, setExitAttempt] = useState<ExitAttempt | null>(null);
  const allowLeave = useRef(false);

  useEffect(() => {
    getGuestReservation(reservationId)
      .then(setView)
      .catch((caught: unknown) => setError(caught instanceof StorefrontApiError ? caught.message : 'Could not load this request.'));
  }, [reservationId]);

  const ready = view !== null;
  useEffect(() => {
    if (!ready) return;
    window.history.pushState({ guestProofGuard: true }, '', window.location.href);

    const onPopState = () => {
      if (allowLeave.current) return;
      window.history.pushState({ guestProofGuard: true }, '', window.location.href);
      setExitAttempt({ kind: 'history' });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      const sameDocument =
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search;
      if (sameDocument && destination.hash === window.location.hash) return;
      event.preventDefault();
      setExitAttempt({ kind: 'link', href: destination.href });
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Window capture runs before storefront transitions listen at document capture.
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('click', onClick, true);
    };
  }, [ready]);

  function leaveProofPage() {
    if (!exitAttempt) return;
    if (exitAttempt.kind === 'link') {
      const destination = new URL(exitAttempt.href, window.location.href);
      const current = new URL(window.location.href);
      const sameDocument =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search;
      if (sameDocument) {
        setExitAttempt(null);
        window.history.pushState(window.history.state, '', destination.href);
        if (destination.hash) {
          const targetId = decodeURIComponent(destination.hash.slice(1));
          document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
        } else {
          window.scrollTo(0, 0);
        }
        return;
      }
      allowLeave.current = true;
      window.location.assign(exitAttempt.href);
      return;
    }
    allowLeave.current = true;
    if (window.history.length > 2) {
      window.history.go(-2);
      return;
    }
    window.location.assign(`/s/${store.slug}`);
  }

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
  if (!view) return <p className="text-sf-muted" role="status">Loading your request…</p>;

  const status = STATUS[view.status];
  return (
    <>
      <div className="mb-8 border border-sf-ink bg-sf-surface px-5 py-4 text-sm" role="note">
        <p className="font-medium">Screenshot this page before leaving.</p>
        <p className="mt-1 text-sf-muted">We do not email reservation confirmations or receipts. Keep this page as your proof.</p>
      </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <p className="text-sm text-sf-muted">Reference {view.reference_code}</p>
          <h1 className="mt-2 font-sf-display text-5xl font-light">{status.title}</h1>
          <p className="mt-4 max-w-xl text-sf-muted">{status.body}</p>
          <dl className="mt-8 space-y-3 border-y border-sf-line py-6 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-sf-muted">{view.items && view.items.length > 1 ? 'Items' : 'Item'}</dt>
              <dd className="text-right">
                {(view.items && view.items.length > 1 ? view.items : [{ name: view.item_name, size_label: view.size_label }]).map((item, index) => (
                  <span key={index} className="block">
                    {item.name}
                    {item.size_label ? ` · ${item.size_label}` : ''}
                  </span>
                ))}
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
            <PaymentStep reservation={view} onSubmitted={setView} />
          ) : (
            <div className="border border-sf-line p-6 text-sm text-sf-muted">
              Questions about this request? Contact {store.name}
              {store.contact.phone ? ` at ${store.contact.phone}` : ''}
              {store.contact.email ? ` or ${store.contact.email}` : ''}.
            </div>
          )}
        </aside>
      </div>
      {exitAttempt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="proof-exit-title" className="w-full max-w-md space-y-4 border border-sf-line bg-sf-bg p-6 shadow-xl">
            <h2 id="proof-exit-title" className="font-sf-display text-3xl">Done screenshot?</h2>
            <p className="text-sm text-sf-muted">Save a screenshot of this page before you leave. We will not email this reservation proof.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="sf-button sf-button-outline" onClick={() => setExitAttempt(null)}>Keep viewing</button>
              <button type="button" className="sf-button sf-button-primary" onClick={leaveProofPage}>I saved it — leave</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
