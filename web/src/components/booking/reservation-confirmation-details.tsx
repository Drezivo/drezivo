import Image from 'next/image';
import Link from 'next/link';

import { getGuestReservationById } from '@/lib/static-capability';
import { staticStorefrontClient } from '@/lib/static-storefront-client';
import { formatPhp } from '@/lib/money';
import { describePaymentStatus, describeReservationStatus } from '@/lib/reservation-status';

type GuestReservationSummary = NonNullable<Awaited<ReturnType<typeof getGuestReservationById>>>;
type PublicStoreProjection = NonNullable<Awaited<ReturnType<typeof staticStorefrontClient.getStore>>>;

interface ReservationConfirmationDetailsProps {
  store: PublicStoreProjection;
  summary: GuestReservationSummary;
}

/** Full-page post-submit confirmation based on the approved storefront reference. */
export function ReservationConfirmationDetails({
  store,
  summary,
}: ReservationConfirmationDetailsProps) {
  const reservationStatus = describeReservationStatus(summary.status);
  const paymentStatus = describePaymentStatus(summary.payment.status);
  const rentalDays = calculateRentalDays(summary.pickupDate, summary.returnDate);
  const basePath = `/s/${store.slug}`;
  const contactHref = store.contactEmail
    ? `mailto:${store.contactEmail}`
    : store.contactPhone
      ? `tel:${store.contactPhone}`
      : `${basePath}#contact`;

  return (
    <section className="relative overflow-hidden bg-storefront-background px-6 py-12 sm:px-10 lg:px-20 lg:py-16">
      <div className="relative z-10 mx-auto max-w-6xl">
        <header className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15 text-3xl text-storefront-brand">
            ✓
          </div>
          <h1 className="mt-5 font-display text-4xl font-semibold text-storefront-brand sm:text-5xl">
            Reservation Received
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-storefront-muted">
            Your reservation has been submitted successfully to {store.displayName}.
          </p>
          <div className="mx-auto mt-6 max-w-lg rounded-md bg-storefront-soft px-5 py-4 text-sm text-storefront-muted">
            Reservation updates will use{' '}
            <span className="font-semibold text-storefront-ink">{summary.customer.email}</span>.
          </div>
          <div className="mt-5">
            <span className="inline-flex min-h-11 items-center rounded-full border border-storefront-brand/30 bg-storefront-paper px-5 text-sm font-semibold text-storefront-brand">
              Reservation #{summary.referenceNumber}
            </span>
          </div>
        </header>

        <section
          id="reservation-details"
          className="mt-10 overflow-hidden rounded-md border border-storefront-line bg-storefront-paper shadow-storefront-card"
        >
          <div className="grid gap-0 lg:grid-cols-[1.45fr_0.8fr]">
            <div className="grid gap-6 p-5 sm:grid-cols-[13rem_1fr] sm:p-6">
              <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-storefront-soft">
                <Image
                  src={summary.item.imageUrl}
                  alt={summary.item.name}
                  fill
                  sizes="208px"
                  className="object-cover"
                />
              </div>

              <div className="min-w-0 py-1">
                <h2 className="font-display text-3xl font-semibold text-storefront-ink">
                  {summary.item.name}
                </h2>
                <p className="mt-2 text-sm text-storefront-muted">Size: {summary.item.size}</p>

                <div className="mt-7 flex items-start gap-3">
                  <CalendarIcon />
                  <div>
                    <p className="text-sm font-semibold text-storefront-ink">Rental Period</p>
                    <p className="mt-1 text-sm text-storefront-muted">
                      {formatReservationDate(summary.pickupDate)} →{' '}
                      {formatReservationDate(summary.returnDate)}
                    </p>
                    <p className="mt-1 text-xs text-storefront-muted">
                      {rentalDays} day{rentalDays === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <DetailValue
                    label="Pickup Date"
                    value={formatReservationDate(summary.pickupDate)}
                  />
                  <DetailValue
                    label="Return Date"
                    value={formatReservationDate(summary.returnDate)}
                  />
                </div>
              </div>
            </div>

            <aside className="border-t border-storefront-line bg-storefront-soft/60 p-5 sm:p-6 lg:border-l lg:border-t-0">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-semibold text-storefront-ink">Reservation Status</p>
                <StatusPill label={reservationStatus.label} tone={reservationStatus.tone} />
              </div>

              <dl className="mt-7 space-y-3 text-sm">
                <SummaryRow
                  label="Rental Fee"
                  value={formatPhp(summary.pricing.rentalFeeDecimal)}
                />
                <SummaryRow
                  label="Security Deposit"
                  value={formatPhp(summary.pricing.securityDepositDecimal)}
                />
                <div className="flex items-center justify-between gap-4 border-t border-storefront-line pt-4 text-lg font-semibold text-storefront-brand">
                  <dt>Total Amount</dt>
                  <dd>{formatPhp(summary.pricing.totalDecimal)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="rounded-md border border-storefront-line bg-storefront-paper p-5 sm:p-6">
            <div className="flex items-center gap-3 text-storefront-brand">
              <CustomerIcon />
              <h2 className="font-display text-2xl font-semibold text-storefront-ink">
                Customer Information
              </h2>
            </div>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
              <DetailValue label="Full Name" value={summary.customer.fullName} />
              <DetailValue label="Contact Number" value={summary.customer.phone} />
              <DetailValue
                label="Email Address"
                value={summary.customer.email}
                className="sm:col-span-2"
              />
            </dl>
          </section>

          <section className="rounded-md border border-storefront-line bg-storefront-paper p-5 sm:p-6">
            <div className="flex items-center gap-3 text-storefront-brand">
              <TruckIcon />
              <h2 className="font-display text-2xl font-semibold text-storefront-ink">
                Pickup / Delivery
              </h2>
            </div>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
              <DetailValue
                label="Method"
                value={summary.pickup.method === 'delivery' ? 'Delivery' : 'Self Pickup'}
              />
              {summary.pickup.location ? (
                <DetailValue label="Location" value={summary.pickup.location} />
              ) : null}
            </dl>

            <div className="mt-6 border-t border-storefront-line pt-5">
              <div className="flex items-center gap-3 text-storefront-brand">
                <PaymentIcon />
                <h3 className="font-display text-xl font-semibold text-storefront-ink">Payment</h3>
              </div>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-storefront-muted">Status</dt>
                  <dd className="mt-2">
                    <StatusPill label={paymentStatus.label} tone={paymentStatus.tone} />
                  </dd>
                </div>
                {summary.payment.reference ? (
                  <DetailValue label="Reference" value={summary.payment.reference} />
                ) : null}
              </dl>
            </div>
          </section>
        </div>

        <section className="mt-4 grid gap-6 rounded-md border border-storefront-line bg-storefront-soft p-5 sm:p-6 lg:grid-cols-2">
          <div className="flex items-start gap-4">
            <ClockIcon />
            <div>
              <h2 className="font-display text-xl font-semibold text-storefront-ink">
                What Happens Next?
              </h2>
              <p className="mt-2 text-sm leading-6 text-storefront-muted">
                {store.displayName} will review your reservation and update its status once the
                reservation and any required payment evidence have been verified.
              </p>
            </div>
          </div>

          <div className="border-t border-storefront-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="flex items-start gap-4">
              <MailIcon />
              <div>
                <h2 className="font-display text-xl font-semibold text-storefront-ink">
                  Need Help?
                </h2>
                <p className="mt-2 text-sm leading-6 text-storefront-muted">
                  Contact the rental business directly if you need help with this reservation.
                </p>
                <a
                  href={contactHref}
                  className="mt-4 inline-flex min-h-11 items-center rounded-md border border-storefront-brand px-4 text-sm font-semibold text-storefront-brand transition hover:bg-storefront-paper"
                >
                  Contact Business →
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link
            href="#reservation-details"
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-storefront-brand px-5 text-sm font-semibold text-storefront-paper transition hover:bg-storefront-accent"
          >
            View Reservation
          </Link>
          <Link
            href={basePath}
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-storefront-brand px-5 text-sm font-semibold text-storefront-brand transition hover:bg-storefront-soft"
          >
            Return to Storefront
          </Link>
          <Link
            href={`${basePath}/catalog`}
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-storefront-brand px-5 text-sm font-semibold text-storefront-brand transition hover:bg-storefront-soft"
          >
            Browse More Clothing
          </Link>
        </div>

        <div className="mt-10 border-t border-storefront-line pt-8 text-center">
          <p className="font-display text-2xl italic text-storefront-brand">Thank you ♡</p>
          <p className="mt-1 text-sm text-storefront-muted">for choosing {store.displayName}</p>
        </div>
      </div>

      <WaveDecoration />
    </section>
  );
}

function DetailValue({
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
      <dd className="font-semibold text-storefront-ink">{value}</dd>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    neutral: 'bg-storefront-soft text-storefront-muted',
  }[tone];

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${toneClass}`}>
      {label}
    </span>
  );
}

function calculateRentalDays(pickupDate: string, returnDate: string): number {
  const pickup = new Date(`${pickupDate}T00:00:00Z`).getTime();
  const returned = new Date(`${returnDate}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((returned - pickup) / 86_400_000));
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

function CalendarIcon() {
  return (
    <IconShell path="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
  );
}

function CustomerIcon() {
  return <IconShell path="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />;
}

function TruckIcon() {
  return (
    <IconShell path="M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
  );
}

function PaymentIcon() {
  return <IconShell path="M3 6h18v12H3V6Zm0 4h18M7 15h4" />;
}

function ClockIcon() {
  return <IconShell path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2" large />;
}

function MailIcon() {
  return <IconShell path="M3 5h18v14H3V5Zm1 2 8 6 8-6" large />;
}

function IconShell({ path, large = false }: { path: string; large?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={large ? 'h-9 w-9 shrink-0 text-storefront-brand' : 'h-5 w-5 shrink-0'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function WaveDecoration() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full text-storefront-brand/10"
      fill="none"
    >
      <path d="M0 78C260 134 398 18 666 71c260 51 453-14 774 9v40H0V78Z" fill="currentColor" />
      <path
        d="M0 92c227 27 386-55 653-16 290 43 436-22 787-8"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
