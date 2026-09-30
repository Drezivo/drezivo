'use client';

import { useEffect, useRef, useState } from 'react';

import type { GuestReservationView } from '@drezivo/contracts';

import { receiptProblem, uploadReceipt } from '@/lib/receipt-upload';
import { StorefrontApiError } from '@/lib/storefront-api';
import { formatMinor } from '@/lib/storefront-format';

function useCountdown(deadline: string | null): number {
  const [left, setLeft] = useState(() => (deadline ? Math.max(0, Date.parse(deadline) - Date.now()) : 0));
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Date.parse(deadline) - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return left;
}

export function MoneyBreakdown({ reservation }: { reservation: GuestReservationView }) {
  const { money } = reservation;
  const rows = [
    { label: 'Rental', value: money.rental_total_minor },
    { label: 'Refundable deposit', value: money.security_required_minor },
    ...(money.delivery_total_minor !== '0' ? [{ label: 'Delivery', value: money.delivery_total_minor }] : []),
  ];
  return (
    <dl className="space-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4">
          <dt className="text-sf-muted">{row.label}</dt>
          <dd className="tabular-nums">{formatMinor(row.value)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-sf-line pt-2 font-medium">
        <dt>Pay now</dt>
        <dd className="tabular-nums">{formatMinor(money.due_now_minor)}</dd>
      </div>
    </dl>
  );
}

/** Shows how to pay, counts down the 15-minute hold, and uploads the receipt once. */
export function PaymentStep({ reservation, token, onSubmitted }: { reservation: GuestReservationView; token: string; onSubmitted: (view: GuestReservationView) => void }) {
  const left = useCountdown(reservation.hold_expires_at);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ file: File; key: string } | null>(null);
  const instructions = reservation.payment_instructions;
  const expired = reservation.hold_expires_at !== null && left === 0;
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);

  async function submit() {
    if (!file || inFlight.current || expired) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    if (intent.current?.file !== file) intent.current = { file, key: crypto.randomUUID() };
    try {
      onSubmitted(await uploadReceipt(reservation.id, token, file, intent.current.key));
    } catch (caught) {
      setError(caught instanceof StorefrontApiError ? caught.message : 'The receipt could not be sent. Try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className={`border px-4 py-3 text-sm ${expired ? 'border-[#b3311f] text-[#b3311f]' : 'border-sf-line'}`} role="timer" aria-live="off">
        {expired ? (
          'Your hold ended before a receipt arrived. Close this and choose your dates again.'
        ) : (
          <>
            Your size is held for{' '}
            <span className="font-medium tabular-nums">
              {minutes}:{String(seconds).padStart(2, '0')}
            </span>
            . Pay and upload the receipt before then.
          </>
        )}
      </div>

      <MoneyBreakdown reservation={reservation} />

      {instructions ? (
        <section aria-labelledby="pay-title" className="space-y-3">
          <h3 id="pay-title" className="font-sf-display text-2xl">
            Pay with {instructions.method_name}
          </h3>
          {instructions.qr_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={instructions.qr_image_url} alt={`${instructions.method_name} QR code`} className="mx-auto w-56 border border-sf-line bg-white p-2" />
          ) : null}
          {instructions.destination_note ? <p className="whitespace-pre-line border border-sf-line bg-sf-surface px-4 py-3 text-sm leading-7">{instructions.destination_note}</p> : null}
          {instructions.material_url ? (
            instructions.material_content_type === 'application/pdf' ? (
              <div className="space-y-2">
                <iframe src={instructions.material_url} title={`${instructions.method_name} payment instructions`} className="h-[28rem] w-full border border-sf-line bg-white" />
                <a href={instructions.material_url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">
                  Open the payment instructions (PDF)
                </a>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={instructions.material_url} alt={`${instructions.method_name} payment instructions`} className="mx-auto w-full max-w-sm border border-sf-line bg-white" />
            )
          ) : null}
          <p className="text-xs text-sf-muted">Send exactly {formatMinor(reservation.money.due_now_minor)} and keep the receipt screenshot.</p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="font-sf-display text-2xl">Upload your receipt</h3>
        <label className="flex cursor-pointer items-center justify-between gap-3 border border-dashed border-sf-ink/40 px-4 py-4 text-sm hover:bg-sf-line/40">
          <span className="min-w-0 truncate">{file ? file.name : 'Choose a screenshot or PDF'}</span>
          <span className="shrink-0 text-xs underline underline-offset-4">{file ? 'Change' : 'Browse'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            disabled={pending || expired}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              event.target.value = '';
              if (chosen && receiptProblem(chosen)) {
                setError(receiptProblem(chosen));
                return;
              }
              setError(null);
              setFile(chosen);
            }}
          />
        </label>
        <button type="button" className="sf-button sf-button-primary w-full" disabled={!file || pending || expired} onClick={() => void submit()}>
          {pending ? 'Sending receipt…' : 'Send request to the shop'}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-[#b3311f]">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
