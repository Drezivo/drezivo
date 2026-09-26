'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { BookingSteps } from '@/components/booking/booking-steps';
import { confirmGuestReservation, getGuestReservationById } from '@/lib/capability';
import { formatPhp } from '@/lib/money';
import { describePaymentStatus } from '@/lib/reservation-status';
import { useSubmitGuard } from '@/lib/use-submit-guard';

type GuestReservationSummary = NonNullable<Awaited<ReturnType<typeof getGuestReservationById>>>;

interface ReservationReviewProps {
  storeSlug: string;
  itemId: string;
  reservationId: string;
  summary: GuestReservationSummary;
}

/** Step 3 review drawer. All displayed reservation values come from the held server snapshot. */
export function ReservationReview({
  storeSlug,
  itemId,
  reservationId,
  summary,
}: ReservationReviewProps) {
  const router = useRouter();
  const paymentStatus = describePaymentStatus(summary.payment.status);

  const { submit, isPending, error } = useSubmitGuard((idempotencyKey) =>
    confirmGuestReservation(reservationId, idempotencyKey),
  );

  async function handleConfirm() {
    try {
      const confirmed = await submit();
      if (!confirmed) return;
      router.push(`/s/${storeSlug}/book/${itemId}/confirmation?rid=${reservationId}`);
    } catch {
      // useSubmitGuard exposes the normalized failure through `error` below.
    }
  }

  function handleClose() {
    router.push(`/s/${storeSlug}/items/${itemId}`);
  }

  function handleBackToDetails() {
    router.push(`/s/${storeSlug}/book/${itemId}/details?rid=${reservationId}`);
  }

  function handleBackToDates() {
    router.push(`/s/${storeSlug}/book/${itemId}?size=${encodeURIComponent(summary.item.size)}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-storefront-overlay backdrop-blur-[1px]">
      <button
        type="button"
        aria-label="Close reservation review"
        className="absolute inset-0 cursor-default"
        onClick={handleClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Review your reservation"
        className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-storefront-paper shadow-2xl"
      >
        <div className="border-b border-storefront-line px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <BookingSteps current={3} />
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
        </div>

        <div className="flex-1 space-y-4 px-6 py-6 sm:px-8">
          <div>
            <h1 className="font-display text-3xl font-semibold text-storefront-ink">
              Review Your Reservation
            </h1>
            <p className="mt-1 text-sm text-storefront-muted">
              Please review all the details before confirming.
            </p>
          </div>

          <ReviewSection
            title="Clothing Details"
            icon={<ClothingIcon />}
            actionLabel="Edit"
            onAction={handleBackToDates}
          >
            <div className="flex gap-4">
              <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-md bg-storefront-soft">
                <Image
                  src={summary.item.imageUrl}
                  alt={summary.item.name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 space-y-2 text-sm">
                <p className="font-semibold text-storefront-ink">{summary.item.name}</p>
                <p className="text-storefront-muted">Size: {summary.item.size}</p>
                <p className="flex items-center gap-2 text-storefront-muted">
                  <CalendarIcon />
                  <span>
                    {formatReservationDate(summary.pickupDate)} →{' '}
                    {formatReservationDate(summary.returnDate)}
                  </span>
                </p>
                <p className="flex items-center gap-2 text-storefront-muted">
                  <ClockIcon />
                  <span>{formatRentalDuration(summary.pickupDate, summary.returnDate)}</span>
                </p>
              </div>
            </div>
          </ReviewSection>

          <ReviewSection
            title="Customer Information"
            icon={<CustomerIcon />}
            actionLabel="Edit"
            onAction={handleBackToDetails}
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ReviewField label="Full Name" value={summary.customer.fullName} />
              <ReviewField label="Contact Number" value={summary.customer.phone} />
              <ReviewField
                label="Email Address"
                value={summary.customer.email}
                className="sm:col-span-2"
              />
            </dl>
          </ReviewSection>

          <ReviewSection
            title="Pickup / Delivery"
            icon={<TruckIcon />}
            actionLabel="Edit"
            onAction={handleBackToDetails}
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ReviewField
                label="Method"
                value={summary.pickup.method === 'delivery' ? 'Delivery' : 'Self Pickup'}
              />
              {summary.pickup.location ? (
                <ReviewField label="Location" value={summary.pickup.location} />
              ) : null}
            </dl>
          </ReviewSection>

          <ReviewSection
            title="Payment"
            icon={<PaymentIcon />}
            actionLabel="Edit"
            onAction={handleBackToDetails}
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ReviewField label="Status" value={paymentStatus.label} />
              {summary.payment.reference ? (
                <ReviewField label="Reference" value={summary.payment.reference} />
              ) : null}
            </dl>
          </ReviewSection>

          <ReviewSection title="Rental Summary" icon={<SummaryIcon />}>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Rental Fee" value={formatPhp(summary.pricing.rentalFeeDecimal)} />
              <SummaryRow
                label="Security Deposit"
                value={formatPhp(summary.pricing.securityDepositDecimal)}
              />
              <div className="flex items-center justify-between gap-4 border-t border-storefront-line pt-3 text-base font-semibold text-storefront-brand">
                <dt>Total Amount</dt>
                <dd>{formatPhp(summary.pricing.totalDecimal)}</dd>
              </div>
            </dl>
          </ReviewSection>

          <section className="rounded-md border border-storefront-line bg-storefront-soft p-4">
            <div className="flex items-start gap-3">
              <InfoIcon />
              <div>
                <h2 className="text-sm font-semibold text-storefront-ink">Important Notes</h2>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-storefront-muted">
                  <li>Your reservation will be reviewed by the business before it is confirmed.</li>
                  <li>Payment evidence, when required, is verified separately by the business.</li>
                  <li>Please make sure your contact information and rental dates are correct.</li>
                </ul>
              </div>
            </div>
          </section>

          {error ? (
            <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-storefront-line bg-storefront-paper px-6 py-5 sm:px-8">
          <button
            type="button"
            disabled={isPending}
            onClick={handleConfirm}
            className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-storefront-brand px-5 text-sm font-semibold text-storefront-paper transition hover:bg-storefront-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Confirming…' : 'Confirm Reservation'}
            {!isPending ? <span aria-hidden="true">→</span> : null}
          </button>
          <button
            type="button"
            onClick={handleBackToDetails}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-storefront-muted hover:text-storefront-brand"
          >
            ← Back to Details
          </button>
        </div>
      </aside>
    </div>
  );
}

function ReviewSection({
  title,
  icon,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-storefront-line bg-storefront-paper p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-storefront-brand">
          {icon}
          <h2 className="text-sm font-semibold text-storefront-ink">{title}</h2>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex min-h-11 items-center text-xs font-semibold text-storefront-brand hover:underline"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReviewField({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-storefront-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium text-storefront-ink">{value}</dd>
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

function formatRentalDuration(pickupDate: string, returnDate: string): string {
  const pickup = new Date(`${pickupDate}T00:00:00Z`).getTime();
  const returned = new Date(`${returnDate}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((returned - pickup) / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function ClothingIcon() {
  return (
    <IconBase>
      <path d="M8 5 4.5 7.5 6.5 11 8 10v9h8v-9l1.5 1 2-3.5L16 5l-2 2h-4L8 5Z" />
      <path d="M10 7c.5 1 1.2 1.5 2 1.5S13.5 8 14 7" />
    </IconBase>
  );
}

function CustomerIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 19c.7-3.4 3-5.2 6.5-5.2s5.8 1.8 6.5 5.2" />
    </IconBase>
  );
}

function TruckIcon() {
  return (
    <IconBase>
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h3l3 3v3h-6" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </IconBase>
  );
}

function PaymentIcon() {
  return (
    <IconBase>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M7 14h4" />
    </IconBase>
  );
}

function SummaryIcon() {
  return (
    <IconBase>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </IconBase>
  );
}

function InfoIcon() {
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-storefront-brand text-xs font-semibold text-storefront-paper"
    >
      i
    </span>
  );
}

function CalendarIcon() {
  return (
    <IconBase>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 9h16" />
    </IconBase>
  );
}

function ClockIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </IconBase>
  );
}
