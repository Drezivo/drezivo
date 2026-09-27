import Image from 'next/image';
import type { StaticGuestReservationSummary } from '@/lib/static-capability';
import { Badge } from '@/components/ui/badge';
import { formatPhp } from '@/lib/money';
import { describePaymentStatus, describeReservationStatus } from '@/lib/reservation-status';

/**
 * Shared read-only reservation display used by both the immediate post-hold
 * confirmation page and the durable `/guest/reservations/[token]` status
 * page — one place that renders payment/reservation status, so the "never
 * show 'Paid'" rule (Drezivo-PRD.md §4) only needs to be honored once.
 */
export function ReservationSummaryCard({ summary }: { summary: StaticGuestReservationSummary }) {
  const reservationStatus = describeReservationStatus(summary.status);
  const paymentStatus = describePaymentStatus(summary.payment.status);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            <div className="relative h-24 w-20 flex-shrink-0 overflow-hidden rounded-md bg-border">
              <Image
                src={summary.item.imageUrl}
                alt=""
                fill
                className="object-cover"
                sizes="80px"
              />
            </div>
            <div>
              <p className="font-medium text-foreground">{summary.item.name}</p>
              <p className="text-sm text-muted">Size: {summary.item.size}</p>
              <p className="mt-1 text-sm text-muted">
                {summary.pickupDate} → {summary.returnDate}
              </p>
            </div>
          </div>
          <Badge tone={reservationStatus.tone}>{reservationStatus.label}</Badge>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium text-foreground">Customer Information</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-muted">Full Name</dt>
              <dd className="text-foreground">{summary.customer.fullName}</dd>
            </div>
            <div>
              <dt className="text-muted">Contact Number</dt>
              <dd className="text-foreground">{summary.customer.phone}</dd>
            </div>
            <div>
              <dt className="text-muted">Email Address</dt>
              <dd className="text-foreground">{summary.customer.email}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium text-foreground">Pickup &amp; Payment</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-muted">Method</dt>
              <dd className="text-foreground">
                {summary.pickup.method === 'delivery' ? 'Delivery' : 'Self Pickup'}
              </dd>
            </div>
            {summary.pickup.location ? (
              <div>
                <dt className="text-muted">Location</dt>
                <dd className="text-foreground">{summary.pickup.location}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-muted">Payment Status</dt>
              <dd>
                <Badge tone={paymentStatus.tone}>{paymentStatus.label}</Badge>
              </dd>
            </div>
            {summary.payment.reference ? (
              <div>
                <dt className="text-muted">Reference</dt>
                <dd className="text-foreground">{summary.payment.reference}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium text-foreground">Rental Summary</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Rental Fee</dt>
            <dd className="text-foreground">{formatPhp(summary.pricing.rentalFeeDecimal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Security Deposit</dt>
            <dd className="text-foreground">{formatPhp(summary.pricing.securityDepositDecimal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Add-ons &amp; Penalties</dt>
            <dd className="text-foreground">{formatPhp(summary.pricing.addOnsDecimal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Discount</dt>
            <dd className="text-foreground">- {formatPhp(summary.pricing.discountDecimal)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-medium text-foreground">
            <dt>Total Amount</dt>
            <dd>{formatPhp(summary.pricing.totalDecimal)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
