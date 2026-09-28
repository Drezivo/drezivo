"use client";

import type {
  CustomerActivity,
  CustomerDetailResponse,
  CustomerFittingHistoryItem,
  CustomerReservationHistoryItem,
} from "@drezivo/contracts";
import { AlertCircle, Mail, MapPin, Phone, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { DrezivoApiError } from "@/lib/drezivo-api";

type PageMeta = { next_cursor: string | null; has_more: boolean };

export function CustomerDetailsSheet({
  detail,
  detailError,
  detailLoading,
  fittingError,
  fittingHistory,
  fittingLoading,
  fittingMeta,
  onFittingNext,
  onFittingPrevious,
  onFittingRetry,
  onOpenChange,
  onReservationNext,
  onReservationPrevious,
  onReservationRetry,
  reservationPageIndex,
  onRetryDetail,
  open,
  reservationError,
  reservationHistory,
  reservationLoading,
  reservationMeta,
  fittingPageIndex,
}: {
  detail: CustomerDetailResponse | null;
  detailError: DrezivoApiError | null;
  detailLoading: boolean;
  fittingError: DrezivoApiError | null;
  fittingHistory: readonly CustomerFittingHistoryItem[];
  fittingLoading: boolean;
  fittingMeta: PageMeta;
  onFittingNext: () => void;
  onFittingPrevious: () => void;
  onFittingRetry: () => void;
  onOpenChange: (open: boolean) => void;
  onReservationNext: () => void;
  onReservationPrevious: () => void;
  onReservationRetry: () => void;
  reservationPageIndex: number;
  onRetryDetail: () => void;
  open: boolean;
  reservationError: DrezivoApiError | null;
  reservationHistory: readonly CustomerReservationHistoryItem[];
  reservationLoading: boolean;
  reservationMeta: PageMeta;
  fittingPageIndex: number;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {detailLoading ? <DetailState title="Loading customer…" message="Fetching the latest customer details." /> : null}
        {!detailLoading && detailError ? (
          <DetailState
            title={detailError.status === 404 ? "Customer unavailable" : "Could not load customer"}
            message={detailError.message}
            requestId={detailError.requestId}
            {...(detailError.status === 404 ? {} : { actionLabel: "Try again", onAction: onRetryDetail })}
          />
        ) : null}
        {!detailLoading && !detailError && detail ? (
          <CustomerDetails
            detail={detail}
            fittingError={fittingError}
            fittingHistory={fittingHistory}
            fittingLoading={fittingLoading}
            fittingMeta={fittingMeta}
            onFittingNext={onFittingNext}
            onFittingPrevious={onFittingPrevious}
            onFittingRetry={onFittingRetry}
            onReservationNext={onReservationNext}
            onReservationPrevious={onReservationPrevious}
            onReservationRetry={onReservationRetry}
            reservationPageIndex={reservationPageIndex}
            reservationError={reservationError}
            reservationHistory={reservationHistory}
            reservationLoading={reservationLoading}
            reservationMeta={reservationMeta}
            fittingPageIndex={fittingPageIndex}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CustomerDetails({
  detail,
  fittingError,
  fittingHistory,
  fittingLoading,
  fittingMeta,
  onFittingNext,
  onFittingPrevious,
  onFittingRetry,
  onReservationNext,
  onReservationPrevious,
  onReservationRetry,
  reservationPageIndex,
  reservationError,
  reservationHistory,
  reservationLoading,
  reservationMeta,
  fittingPageIndex,
}: {
  detail: CustomerDetailResponse;
  fittingError: DrezivoApiError | null;
  fittingHistory: readonly CustomerFittingHistoryItem[];
  fittingLoading: boolean;
  fittingMeta: PageMeta;
  onFittingNext: () => void;
  onFittingPrevious: () => void;
  onFittingRetry: () => void;
  onReservationNext: () => void;
  onReservationPrevious: () => void;
  onReservationRetry: () => void;
  reservationPageIndex: number;
  reservationError: DrezivoApiError | null;
  reservationHistory: readonly CustomerReservationHistoryItem[];
  reservationLoading: boolean;
  reservationMeta: PageMeta;
  fittingPageIndex: number;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-20 sm:px-6 sm:pr-20">
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 border border-dashboard-border">
            <AvatarFallback className="bg-dashboard-active text-sm font-semibold text-dashboard-accent">
              {initials(detail.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-lg">{detail.full_name}</SheetTitle>
              <Badge variant="outline">{detail.status === "active" ? "Active" : "Archived"}</Badge>
            </div>
            <SheetDescription className="mt-1">Customer since {formatDate(detail.created_at)}</SheetDescription>
          </div>
          <Button type="button" variant="secondary" size="sm" disabled aria-disabled="true">
            Edit
          </Button>
        </div>
      </header>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <DetailSection title="Contact Information">
          <div className="grid gap-3 sm:grid-cols-2">
            <ContactItem icon={Phone} label="Phone" value={detail.phone ?? "Not provided"} />
            <ContactItem icon={Mail} label="Email" value={detail.email ?? "Not provided"} />
            <ContactItem icon={MapPin} label="Address" value={detail.address ?? "Not provided"} />
            <ContactItem icon={UserRound} label="Social media" value={detail.social_media ?? "Not provided"} />
          </div>
        </DetailSection>

        <Separator />
        <DetailSection title="Customer Summary">
          <div className="grid grid-cols-3 gap-2">
            <SummaryValue label="Reservations" value={detail.reservation_count} />
            <SummaryValue label="Fittings" value={detail.fitting_count} />
            <SummaryValue label="Completed" value={detail.completed_engagement_count} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ActivityValue label="Last activity" activity={detail.last_activity} fallback="No activity yet" />
            <ActivityValue label="Next activity" activity={detail.next_activity} fallback="None scheduled" />
          </div>
        </DetailSection>

        <Separator />
        <HistorySection
          title="Reservation History"
          loading={reservationLoading}
          error={reservationError}
          requestId={reservationError?.requestId ?? null}
          onRetry={onReservationRetry}
          items={reservationHistory}
          emptyLabel="No reservation history yet."
          meta={reservationMeta}
          canPrevious={reservationPageIndex > 0}
          onNext={onReservationNext}
          onPrevious={onReservationPrevious}
          renderItem={(item) => (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-dashboard-navy">{item.clothing_name_snapshot}</p>
                <p className="mt-1 text-xs text-dashboard-muted">{item.reference_code}</p>
                <p className="mt-2 text-xs text-dashboard-muted">
                  Pickup {formatDateTime(item.pickup_at)} · Due {formatDateTime(item.due_at)}
                </p>
              </div>
              <div className="text-right">
                <Badge variant="outline" className="capitalize">{item.status.replaceAll("_", " ")}</Badge>
                <p className="mt-2 text-sm font-medium text-dashboard-navy">{formatMoney(item.rental_total_minor, item.currency)}</p>
              </div>
            </div>
          )}
        />

        <Separator />
        <HistorySection
          title="Fitting History"
          loading={fittingLoading}
          error={fittingError}
          requestId={fittingError?.requestId ?? null}
          onRetry={onFittingRetry}
          items={fittingHistory}
          emptyLabel="No fitting history yet."
          meta={fittingMeta}
          canPrevious={fittingPageIndex > 0}
          onNext={onFittingNext}
          onPrevious={onFittingPrevious}
          renderItem={(item) => (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-dashboard-navy">{formatDateTime(item.starts_at)}</p>
                <p className="mt-1 text-xs text-dashboard-muted">{item.garment_summary ?? "No garment preference recorded"}</p>
              </div>
              <div className="text-right">
                <Badge variant="outline" className="capitalize">{item.status.replaceAll("_", " ")}</Badge>
                <p className="mt-2 text-xs text-dashboard-muted">
                  {formatMoney(item.fee.fee_minor, item.fee.currency)} · {item.fee.payment_status ?? "Payment not recorded"}
                </p>
              </div>
            </div>
          )}
        />

        <Separator />
        <DetailSection title="Internal Notes">
          <Card className="gap-0 py-0"><CardContent className="p-4 text-sm leading-6 text-dashboard-muted">{detail.notes ?? "No internal notes for this customer."}</CardContent></Card>
        </DetailSection>
      </div>
    </div>
  );
}

function HistorySection<T>({
  emptyLabel,
  canPrevious,
  error,
  items,
  loading,
  meta,
  onNext,
  onPrevious,
  onRetry,
  renderItem,
  requestId,
  title,
}: {
  emptyLabel: string;
  error: DrezivoApiError | null;
  canPrevious: boolean;
  items: readonly T[];
  loading: boolean;
  meta: PageMeta;
  onNext: () => void;
  onPrevious: () => void;
  onRetry: () => void;
  renderItem: (item: T) => React.ReactNode;
  requestId?: string | null;
  title: string;
}) {
  return (
    <DetailSection title={title}>
      {loading ? <div aria-label={`Loading ${title}`} aria-busy="true" className="h-24 animate-pulse rounded-lg border border-dashboard-border bg-dashboard-active" /> : null}
      {!loading && error ? (
        <div role="alert" className="rounded-lg border border-dashboard-border bg-dashboard-canvas p-3 text-sm text-dashboard-muted">
          <p>{error.message}</p>
          {requestId ? <p className="mt-1 text-xs">Request ID: {requestId}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
      {!loading && !error && items.length === 0 ? <p className="text-sm text-dashboard-muted">{emptyLabel}</p> : null}
      {!loading && !error && items.length > 0 ? <div className="space-y-2">{items.map((item, index) => <Card key={index} className="gap-0 py-0"><CardContent className="p-4">{renderItem(item)}</CardContent></Card>)}</div> : null}
      {!loading && !error && items.length > 0 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-dashboard-muted">
          <Button type="button" variant="ghost" size="sm" onClick={onPrevious} disabled={!canPrevious}>Previous</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onNext} disabled={!meta.has_more || !meta.next_cursor}>Next</Button>
        </div>
      ) : null}
    </DetailSection>
  );
}

function DetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <section><h2 className="mb-3 text-sm font-semibold text-dashboard-navy">{title}</h2>{children}</section>;
}

function ContactItem({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-dashboard-border p-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" /><div><p className="text-xs text-dashboard-muted">{label}</p><p className="mt-1 break-words text-sm font-medium text-dashboard-navy">{value}</p></div></div>;
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-dashboard-border p-3"><p className="text-xs text-dashboard-muted">{label}</p><p className="mt-1 text-lg font-semibold text-dashboard-navy">{value}</p></div>;
}

function ActivityValue({ activity, fallback, label }: { activity: CustomerActivity | null; fallback: string; label: string }) {
  return <div className="rounded-lg border border-dashboard-border p-3"><p className="text-xs text-dashboard-muted">{label}</p><p className="mt-1 text-sm font-medium capitalize text-dashboard-navy">{activity?.type ?? fallback}</p>{activity ? <p className="mt-1 text-xs text-dashboard-muted">{formatDateTime(activity.at)}</p> : null}</div>;
}

function DetailState({ actionLabel, message, onAction, requestId, title }: { actionLabel?: string; message: string; onAction?: () => void; requestId?: string | null; title: string }) {
  return <div className="flex min-h-full flex-col"><header className="border-b border-dashboard-border px-5 py-5 pr-14"><SheetTitle>{title}</SheetTitle><SheetDescription className="mt-1">{message}</SheetDescription></header><div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"><AlertCircle className="h-8 w-8 text-dashboard-accent" aria-hidden="true" />{requestId ? <p className="text-xs text-dashboard-muted">Request ID: {requestId}</p> : null}{actionLabel && onAction ? <Button type="button" variant="secondary" onClick={onAction}>{actionLabel}</Button> : null}</div></div>;
}

function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join(""); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("en-PH", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function formatMoney(minor: string, currency: string): string { return new Intl.NumberFormat("en-PH", { currency, maximumFractionDigits: 0, style: "currency" }).format(Number(minor) / 100); }
