"use client";

import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  PackageCheck,
  Shirt,
  Truck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { PermissionCode, ReservationDetail } from "@drezivo/contracts";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { DrezivoApiError } from "@/lib/drezivo-api";
import { displaySizeLabel } from "@/lib/catalogue-display";
import { cn } from "@/lib/utils";

import {
  ReservationMutationActions,
  ReservationMutationNoticeBanner,
  type ReservationMutationNotice,
} from "./reservation-mutation-actions";
import {
  PAYMENT_EVIDENCE_LABELS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  RESERVATION_STATUS_CLASSES,
  RESERVATION_STATUS_LABELS,
} from "./reservations-data";

export function ReservationDetailsSheet({
  detail,
  error,
  isLoading,
  onOpenChange,
  onMutationSuccess,
  onRefreshRequired,
  onRetry,
  permissionCodes,
  reservationId,
  timeZone,
}: {
  detail: ReservationDetail | null;
  error: DrezivoApiError | null;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onMutationSuccess: () => void;
  onRefreshRequired: () => void;
  onRetry: () => void;
  permissionCodes: readonly PermissionCode[];
  reservationId: string | null;
  timeZone: string;
}) {
  const open = reservationId !== null;
  const isForbidden = error?.status === 403 || error?.code === "FORBIDDEN";
  const isMissing = error?.status === 404;
  const [notice, setNotice] = useState<ReservationMutationNotice | null>(null);

  useEffect(() => {
    setNotice(null);
  }, [reservationId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {isLoading ? (
          <DetailState
            title="Loading reservation…"
            message="Fetching the latest reservation details from Drezivo."
          />
        ) : error ? (
          <DetailState
            title={
              isForbidden
                ? "Reservation access is restricted"
                : isMissing
                  ? "Reservation is no longer available"
                  : "Could not load reservation"
            }
            message={
              isForbidden
                ? "Your current branch permissions do not allow access to this reservation. Ask a workspace owner to review your access."
                : error.message
            }
            requestId={error.requestId}
            {...(!isForbidden && !isMissing ? { actionLabel: "Try again", onAction: onRetry } : {})}
          />
        ) : detail ? (
          <ReservationDetails
            detail={detail}
            notice={notice}
            onMutationSuccess={onMutationSuccess}
            onNotice={setNotice}
            onRefreshRequired={onRefreshRequired}
            permissionCodes={permissionCodes}
            timeZone={timeZone}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ReservationDetails({
  detail,
  notice,
  onMutationSuccess,
  onNotice,
  onRefreshRequired,
  permissionCodes,
  timeZone,
}: {
  detail: ReservationDetail;
  notice: ReservationMutationNotice | null;
  onMutationSuccess: () => void;
  onNotice: (notice: ReservationMutationNotice | null) => void;
  onRefreshRequired: () => void;
  permissionCodes: readonly PermissionCode[];
  timeZone: string;
}) {
  const customer = detail.customer.snapshot;
  const effectiveTimeZone = detail.timezone_snapshot || timeZone;
  const [failedImageLines, setFailedImageLines] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFailedImageLines(new Set());
  }, [detail.id]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-lg">Reservation {detail.reference_code}</SheetTitle>
          <Badge
            variant="outline"
            className={cn(
              "whitespace-nowrap px-2 py-1 text-xs",
              RESERVATION_STATUS_CLASSES[detail.status]
            )}
          >
            {RESERVATION_STATUS_LABELS[detail.status]}
          </Badge>
        </div>
        <SheetDescription className="mt-1">
          Created {formatDateTime(detail.created_at, effectiveTimeZone)} · Version {detail.version}
        </SheetDescription>

        {notice ? (
          <div className="mt-4">
            <ReservationMutationNoticeBanner notice={notice} />
          </div>
        ) : null}

        <ReservationMutationActions
          detail={detail}
          permissionCodes={permissionCodes}
          onNotice={onNotice}
          onMutationSuccess={onMutationSuccess}
          onRefreshRequired={onRefreshRequired}
        />
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <DetailCard title="Customer" icon={UserRound}>
          {customer ? (
            <div className="flex items-start gap-3">
              <Avatar className="h-11 w-11 border border-dashboard-border">
                <AvatarFallback className="bg-dashboard-active font-semibold text-dashboard-accent">
                  {initials(customer.full_name)}
                </AvatarFallback>
              </Avatar>
              <dl className="grid min-w-0 flex-1 gap-2 text-sm sm:grid-cols-2">
                <DetailValue label="Name" value={customer.full_name} />
                <DetailValue label="Phone" value={customer.phone ?? "Not provided"} />
                <DetailValue label="Email" value={customer.email ?? "Not provided"} />
                <DetailValue label="Address" value={customer.address ?? "Not recorded"} />
                <DetailValue
                  label="Customer record"
                  value={detail.customer.customer_id ? "Linked customer" : "Snapshot only"}
                />
              </dl>
            </div>
          ) : (
            <div className="rounded-lg border border-dashboard-border bg-dashboard-active/40 p-3">
              <p className="font-medium text-dashboard-navy">Customer not added yet</p>
              <p className="mt-1 text-xs text-dashboard-muted">
                This is a short staff hold. Customer details can be attached before completion.
              </p>
            </div>
          )}
        </DetailCard>

        <DetailCard title={`Rental ${detail.lines.length === 1 ? "item" : "items"}`} icon={Shirt}>
          <div className="space-y-4">
            {detail.lines.map((line, index) => (
              <div key={line.id}>
                {index > 0 ? <Separator className="mb-4" /> : null}
                <div className="flex items-start gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active text-dashboard-accent">
                    {line.variant.image_url && !failedImageLines.has(line.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- API-provided signed URLs are short-lived and dynamic.
                      <img
                        src={line.variant.image_url}
                        alt={`${line.name_snapshot} cover image`}
                        className="h-full w-full object-cover"
                        onError={() =>
                          setFailedImageLines((current) => {
                            const next = new Set(current);
                            next.add(line.id);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <Shirt className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-dashboard-navy">{line.name_snapshot}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">Line {line.line_number}</p>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <DetailValue
                        label="Variant"
                        value={`${displaySizeLabel(line.variant.size_label)}${line.variant.color_label ? ` · ${line.variant.color_label}` : ""}`}
                      />
                      <DetailValue label="SKU" value={line.variant.sku} />
                      <DetailValue
                        label="Rental"
                        value={formatMinorMoney(
                          line.pricing_snapshot.rental_minor,
                          line.pricing_snapshot.currency
                        )}
                      />
                      <DetailValue
                        label="Deposit"
                        value={formatMinorMoney(
                          line.pricing_snapshot.deposit_minor,
                          line.pricing_snapshot.currency
                        )}
                      />
                    </div>
                    {Object.keys(line.measurements_snapshot).length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-dashboard-muted">
                          Measurements at booking
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(line.measurements_snapshot).map(([label, value]) => (
                            <span
                              key={label}
                              className="rounded-md bg-dashboard-active px-2 py-1 text-xs text-dashboard-navy"
                            >
                              {humanize(label)}: {value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Rental schedule" icon={CalendarDays}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <DetailValue
              label="Pickup"
              value={formatDateTime(detail.pickup_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Return due"
              value={formatDateTime(detail.due_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Fulfillment"
              value={
                detail.delivery_snapshot.fulfillment_method === "pickup" ? "Pickup" : "Delivery"
              }
            />
            <DetailValue label="Event date" value={detail.event_date ?? "Not provided"} />
          </dl>
        </DetailCard>

        <DetailCard title="Price and payment" icon={CreditCard}>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <DetailValue
              label="Rental total"
              value={formatMinorMoney(
                detail.price_snapshot.rental_total_minor,
                detail.price_snapshot.currency
              )}
            />
            <DetailValue
              label="Security deposit"
              value={formatMinorMoney(
                detail.price_snapshot.security_required_minor,
                detail.price_snapshot.currency
              )}
            />
            <DetailValue
              label="Due now"
              value={formatMinorMoney(
                detail.price_snapshot.due_now_minor,
                detail.price_snapshot.currency
              )}
            />
          </dl>

          <Separator className="my-4" />

          {detail.payment ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailValue
                label="Payment method"
                value={`${detail.payment.method_name}${
                  detail.payment.rail === "cash"
                    ? " · Cash"
                    : detail.payment.rail === "manual_qr"
                      ? " · Manual QR"
                      : " · Manual transfer"
                }`}
              />
              <div>
                <p className="text-xs text-dashboard-muted">Payment status</p>
                <Badge
                  variant="outline"
                  className={cn(
                    "mt-1.5 px-2 py-1 text-xs",
                    PAYMENT_STATUS_CLASSES[detail.payment.status]
                  )}
                >
                  {PAYMENT_STATUS_LABELS[detail.payment.status]}
                </Badge>
              </div>
              <DetailValue
                label="Evidence"
                value={
                  detail.payment.rail !== "cash" &&
                  detail.payment.status === "paid" &&
                  detail.payment.verified_at &&
                  detail.payment.evidence_status === "awaiting_upload"
                    ? "Not provided (optional)"
                    : PAYMENT_EVIDENCE_LABELS[detail.payment.evidence_status]
                }
              />
              <DetailValue
                label="Recorded amount"
                value={formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)}
              />
              {detail.payment.rail === "cash" && detail.payment.cash_tendered_minor !== null ? (
                <DetailValue
                  label="Cash tendered"
                  value={formatMinorMoney(
                    detail.payment.cash_tendered_minor,
                    detail.payment.currency
                  )}
                />
              ) : null}
              {detail.payment.rail === "cash" && detail.payment.change_due_minor !== null ? (
                <DetailValue
                  label="Change due"
                  value={formatMinorMoney(detail.payment.change_due_minor, detail.payment.currency)}
                />
              ) : null}
              <DetailValue
                label="Verified"
                value={
                  detail.payment.verified_at
                    ? formatDateTime(detail.payment.verified_at, effectiveTimeZone)
                    : "Not verified"
                }
              />
            </div>
          ) : (
            <p className="text-sm text-dashboard-muted">No payment intent is recorded yet.</p>
          )}
        </DetailCard>

        <DetailCard title="Reservation lifecycle" icon={Clock3}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <DetailValue
              label="Hold acquired"
              value={formatDateTime(detail.hold_acquired_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Hold expires"
              value={
                detail.hold_expires_at
                  ? formatDateTime(detail.hold_expires_at, effectiveTimeZone)
                  : "No active hold deadline"
              }
            />
            <DetailValue
              label="Terms accepted"
              value={formatOptionalDate(detail.terms_accepted_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Submitted"
              value={formatOptionalDate(detail.submitted_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Confirmed"
              value={formatOptionalDate(detail.confirmed_at, effectiveTimeZone)}
            />
            <DetailValue
              label="Completed"
              value={formatOptionalDate(detail.completed_at, effectiveTimeZone)}
            />
          </dl>
        </DetailCard>

        <DetailCard title="Custody history" icon={Truck}>
          {detail.custody_timeline.length > 0 ? (
            <ol className="space-y-3">
              {detail.custody_timeline.map((event, index) => (
                <li
                  key={`${event.asset_id}:${event.event_kind}:${event.occurred_at}`}
                  className="flex gap-3"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
                    {event.event_kind === "pickup" ? (
                      <PackageCheck className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium capitalize text-dashboard-navy">
                        {event.event_kind === "pickup" ? "Picked up" : "Returned"}
                      </p>
                      <p className="text-xs text-dashboard-muted">
                        {formatDateTime(event.occurred_at, effectiveTimeZone)}
                      </p>
                    </div>
                    {event.condition_note ? (
                      <p className="mt-1 text-sm text-dashboard-muted">{event.condition_note}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-dashboard-muted">Event {index + 1}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-dashboard-muted">
              No pickup or return events have been recorded yet.
            </p>
          )}
        </DetailCard>
      </div>
    </div>
  );
}

function DetailCard({
  children,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  icon: typeof CalendarDays;
  title: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-dashboard-navy">{title}</h3>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-dashboard-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium text-dashboard-navy">{value}</dd>
    </div>
  );
}

function DetailState({
  actionLabel,
  message,
  onAction,
  requestId,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  requestId?: string | null;
  title: string;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-14">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription className="mt-1">{message}</SheetDescription>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <Clock3 className="h-8 w-8 text-dashboard-accent" aria-hidden="true" />
        {requestId ? <p className="text-xs text-dashboard-muted">Request ID: {requestId}</p> : null}
        {actionLabel && onAction ? (
          <Button type="button" variant="secondary" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function formatOptionalDate(value: string | null, timeZone: string): string {
  return value ? formatDateTime(value, timeZone) : "Not yet";
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(value));
}

function formatMinorMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("en-PH", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number(value) / 100);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
