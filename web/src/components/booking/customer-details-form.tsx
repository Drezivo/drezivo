'use client';

import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { BookingSteps } from '@/components/booking/booking-steps';
import { submitGuestReservationDetails, type SubmitGuestDetailsInput } from '@/lib/capability';
import { formatPhp } from '@/lib/money';
import { useSubmitGuard } from '@/lib/use-submit-guard';

type PickupMethod = SubmitGuestDetailsInput['pickupMethod'];
type PaymentMethod = SubmitGuestDetailsInput['paymentMethod'];

interface CustomerDetailsFormProps {
  storeSlug: string;
  itemId: string;
  reservationId: string;
  itemName: string;
  itemCategory: string;
  itemImageUrl?: string;
  selectedSize: string;
  pickupDate: string;
  returnDate: string;
  rentalUnitLabel: string;
  rentalFeeDecimal: string;
  securityDepositDecimal: string;
  totalDecimal: string;
}

/** Step 2 customer details drawer. Prices and rental dates are read-only server snapshots. */
export function CustomerDetailsForm({
  storeSlug,
  itemId,
  reservationId,
  itemName,
  itemCategory,
  itemImageUrl,
  selectedSize,
  pickupDate,
  returnDate,
  rentalUnitLabel,
  rentalFeeDecimal,
  securityDepositDecimal,
  totalDecimal,
}: CustomerDetailsFormProps) {
  const router = useRouter();
  const [pickupMethod, setPickupMethod] = useState<PickupMethod>('self_pickup');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('gcash');
  const pendingDetailsRef = useRef<SubmitGuestDetailsInput | null>(null);

  const { submit, isPending, error, resetIntent } = useSubmitGuard(async (idempotencyKey) => {
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

    try {
      const result = await submit();
      if (!result) return;
      router.push(`/s/${storeSlug}/book/${itemId}/review?rid=${reservationId}`);
    } catch {
      // useSubmitGuard exposes the normalized failure through `error` below.
    }
  }

  function handleClose() {
    router.push(`/s/${storeSlug}/items/${itemId}`);
  }

  function handleBackToDates() {
    router.push(`/s/${storeSlug}/book/${itemId}?size=${encodeURIComponent(selectedSize)}`);
  }

  function handlePickupMethod(method: PickupMethod) {
    setPickupMethod(method);
  }

  function handlePaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-storefront-overlay backdrop-blur-[1px]">
      <button
        type="button"
        aria-label="Close reservation details"
        className="absolute inset-0 cursor-default"
        onClick={handleClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Reservation details"
        className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-storefront-paper shadow-2xl"
      >
        <form onSubmit={handleSubmit} onChange={resetIntent} className="flex min-h-full flex-col">
          <div className="border-b border-storefront-line px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-5">
              <div className="flex min-w-0 items-center gap-4">
                <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-md bg-storefront-soft">
                  {itemImageUrl ? (
                    <Image src={itemImageUrl} alt="" fill sizes="56px" className="object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-semibold text-storefront-ink">
                    {itemName}
                  </p>
                  <p className="mt-1 text-sm text-storefront-muted">
                    {itemCategory} · Size {selectedSize}
                  </p>
                  <p className="mt-1 text-xs text-storefront-muted">
                    {formatPhp(rentalFeeDecimal)} · {rentalUnitLabel}
                  </p>
                  <p className="mt-1 text-xs text-storefront-muted">
                    Security Deposit: {formatPhp(securityDepositDecimal)} refundable
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-2xl text-storefront-ink transition hover:bg-storefront-soft"
              >
                ×
              </button>
            </div>

            <div className="mt-5">
              <BookingSteps current={2} />
            </div>
          </div>

          <div className="flex-1 space-y-4 px-6 py-6 sm:px-8">
            <div>
              <h1 className="font-display text-3xl font-semibold text-storefront-ink">
                Reservation Details
              </h1>
              <p className="mt-1 text-sm text-storefront-muted">
                Fill in the remaining details to complete your reservation.
              </p>
            </div>

            <FormSection title="Your Information">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full Name" required className="sm:col-span-2">
                  <input
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    required
                    placeholder="Juan Dela Cruz"
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Contact Number" required className="sm:col-span-2">
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    placeholder="+63 912 345 6789"
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Email Address" required className="sm:col-span-2">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Pickup / Delivery Method"
              description="Choose how you would like to receive your rental item."
            >
              <div className="space-y-2">
                <ChoiceCard
                  name="pickupMethodChoice"
                  label="Self Pickup"
                  description="Pick up at the rental store"
                  checked={pickupMethod === 'self_pickup'}
                  onChange={() => handlePickupMethod('self_pickup')}
                />
                <ChoiceCard
                  name="pickupMethodChoice"
                  label="Delivery"
                  description="Have the business deliver your rental"
                  checked={pickupMethod === 'delivery'}
                  onChange={() => handlePickupMethod('delivery')}
                />
              </div>

              {pickupMethod === 'delivery' ? (
                <Field label="Delivery Address" required className="mt-4">
                  <input
                    name="deliveryAddress"
                    type="text"
                    autoComplete="street-address"
                    required
                    placeholder="Enter the complete delivery address"
                    className={INPUT_CLASS}
                  />
                </Field>
              ) : null}
            </FormSection>

            <FormSection title="Rental Dates">
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="Rental Date" value={formatReservationDate(pickupDate)} />
                <ReadOnlyField label="Return Date" value={formatReservationDate(returnDate)} />
                <Field label="Event Date (optional)">
                  <input name="eventDate" type="date" className={INPUT_CLASS} />
                </Field>
                <ReadOnlyField label="Rental Duration" value={rentalUnitLabel} />
              </div>

              <div className="mt-4 grid gap-3 border-t border-storefront-line pt-4 sm:grid-cols-2">
                <SummaryMetric label="Rental Fee" value={formatPhp(rentalFeeDecimal)} />
                <SummaryMetric label="Security Deposit" value={formatPhp(securityDepositDecimal)} />
              </div>
            </FormSection>

            <FormSection title="Payment Method">
              <div className="grid grid-cols-3 gap-2">
                <PaymentChoice
                  method="gcash"
                  label="GCash"
                  checked={paymentMethod === 'gcash'}
                  onChange={() => handlePaymentMethod('gcash')}
                />
                <PaymentChoice
                  method="maya"
                  label="Maya"
                  checked={paymentMethod === 'maya'}
                  onChange={() => handlePaymentMethod('maya')}
                />
                <PaymentChoice
                  method="cash"
                  label="Cash"
                  checked={paymentMethod === 'cash'}
                  onChange={() => handlePaymentMethod('cash')}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-storefront-muted">
                Choosing a payment method does not mark the reservation as paid. Payment status is
                updated only after the business verifies payment.
              </p>
            </FormSection>

            <section className="rounded-md border border-storefront-line bg-storefront-soft p-4">
              <h2 className="text-sm font-semibold text-storefront-ink">Summary</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <SummaryRow label="Rental Fee" value={formatPhp(rentalFeeDecimal)} />
                <SummaryRow label="Security Deposit" value={formatPhp(securityDepositDecimal)} />
                <div className="flex items-center justify-between gap-4 border-t border-storefront-line pt-3 font-semibold text-storefront-brand">
                  <dt>Total Amount</dt>
                  <dd>{formatPhp(totalDecimal)}</dd>
                </div>
              </dl>
            </section>

            {error ? (
              <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
                {error.message}
              </p>
            ) : null}
          </div>

          <div className="sticky bottom-0 border-t border-storefront-line bg-storefront-paper px-6 py-5 sm:px-8">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-storefront-brand px-5 text-sm font-semibold text-storefront-paper transition hover:bg-storefront-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Continue'}
              {!isPending ? <span aria-hidden="true">→</span> : null}
            </button>
            <button
              type="button"
              onClick={handleBackToDates}
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-storefront-muted hover:text-storefront-brand"
            >
              ← Back to Dates
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

const INPUT_CLASS =
  'mt-1 min-h-11 w-full rounded-md border border-storefront-line bg-storefront-paper px-3 py-2 text-sm text-storefront-ink placeholder:text-storefront-muted/60 focus:border-storefront-brand';

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-storefront-line bg-storefront-paper p-4">
      <h2 className="text-sm font-semibold text-storefront-ink">{title}</h2>
      {description ? <p className="mt-1 text-xs text-storefront-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  required = false,
  className = '',
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-xs font-medium text-storefront-muted ${className}`}>
      <span>
        {label} {required ? <span aria-hidden="true">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-storefront-muted">{label}</p>
      <p className="mt-1 flex min-h-11 items-center rounded-md border border-storefront-line bg-storefront-soft px-3 text-sm text-storefront-ink">
        {value}
      </p>
    </div>
  );
}

function ChoiceCard({
  name,
  label,
  description,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition ${
        checked
          ? 'border-storefront-brand bg-storefront-soft'
          : 'border-storefront-line bg-storefront-paper hover:bg-storefront-soft'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-storefront-brand"
      />
      <span>
        <span className="block text-sm font-semibold text-storefront-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-storefront-muted">{description}</span>
      </span>
    </label>
  );
}

function PaymentChoice({
  method,
  label,
  checked,
  onChange,
}: {
  method: PaymentMethod;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
        checked
          ? 'border-storefront-brand bg-storefront-soft text-storefront-brand'
          : 'border-storefront-line bg-storefront-paper text-storefront-muted hover:bg-storefront-soft'
      }`}
    >
      <input
        type="radio"
        name="paymentMethodChoice"
        value={method}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-storefront-brand"
      />
      {label}
    </label>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-storefront-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-storefront-brand">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-storefront-muted">{label}</dt>
      <dd className="font-medium text-storefront-ink">{value}</dd>
    </div>
  );
}

function formatReservationDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
