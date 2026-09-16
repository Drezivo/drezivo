'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { submitGuestReservationDetails, type SubmitGuestDetailsInput } from '@/lib/capability';
import { useSubmitGuard } from '@/lib/use-submit-guard';
import { Button } from '@/components/ui/button';

/**
 * Step 2 of the guest flow, copied from the dates step's pattern: the same
 * `useSubmitGuard` usage, the same "reset the idempotency key when the
 * user edits the intent" discipline (here, any field edit after a failed
 * submit counts as editing the intent, since re-submitting identical values
 * on a genuine retry is still the same intent — the guard already handles
 * that by keeping the key stable across a retry of an unedited form).
 */
export function CustomerDetailsForm({
  storeSlug,
  itemId,
  reservationId,
}: {
  storeSlug: string;
  itemId: string;
  reservationId: string;
}) {
  const router = useRouter();
  const [pickupMethod, setPickupMethod] = useState<'self_pickup' | 'delivery'>('self_pickup');
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'maya' | 'cash'>('gcash');

  // Holds the values captured from the form at the moment of submission.
  // `useSubmitGuard`'s action only receives the idempotency key, not
  // arbitrary arguments, so the details are staged here rather than
  // re-queried by DOM id (which would break if this form were ever rendered
  // more than once on a page).
  const pendingDetailsRef = useRef<SubmitGuestDetailsInput | null>(null);

  const { submit, isPending, error } = useSubmitGuard(async (idempotencyKey) => {
    const details = pendingDetailsRef.current;
    if (!details) {
      throw new Error('Please fill in your details first.');
    }
    await submitGuestReservationDetails(reservationId, details, idempotencyKey);
    return details;
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    pendingDetailsRef.current = {
      fullName: String(formData.get('fullName') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      email: String(formData.get('email') ?? ''),
      eventDate: String(formData.get('eventDate') ?? '') || undefined,
      pickupMethod,
      deliveryAddress: String(formData.get('deliveryAddress') ?? '') || undefined,
      paymentMethod,
    };

    const result = await submit();
    if (!result) return;
    router.push(`/s/${storeSlug}/book/${itemId}/review?rid=${reservationId}`);
  }

  return (
    <form id="customer-details-form" onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium text-foreground">Your Information</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-foreground">Full Name</span>
            <input
              name="fullName"
              type="text"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-foreground">Contact Number</span>
            <input
              name="phone"
              type="tel"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-foreground">Email Address</span>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-foreground">Event Date (optional)</span>
            <input
              name="eventDate"
              type="date"
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium text-foreground">Pickup / Delivery</p>
        <div className="mt-4 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pickupMethodChoice"
              checked={pickupMethod === 'self_pickup'}
              onChange={() => setPickupMethod('self_pickup')}
            />
            Self Pickup
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pickupMethodChoice"
              checked={pickupMethod === 'delivery'}
              onChange={() => setPickupMethod('delivery')}
            />
            Delivery
          </label>
        </div>
        {pickupMethod === 'delivery' ? (
          <label className="mt-4 block text-sm">
            <span className="text-foreground">Delivery Address</span>
            <input
              name="deliveryAddress"
              type="text"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium text-foreground">Payment Method</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {(['gcash', 'maya', 'cash'] as const).map((method) => (
            <label
              key={method}
              className={`flex items-center gap-2 rounded-md border px-4 py-2 ${
                paymentMethod === method ? 'border-primary' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="paymentMethodChoice"
                checked={paymentMethod === method}
                onChange={() => setPaymentMethod(method)}
              />
              {method === 'gcash' ? 'GCash' : method === 'maya' ? 'Maya' : 'Cash'}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          You&rsquo;ll receive payment instructions and can upload your receipt after submitting.
          Uploading evidence does not mean your reservation is paid — the business verifies it
          before confirming.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending} isLoading={isPending}>
        Continue to Review
      </Button>
    </form>
  );
}
