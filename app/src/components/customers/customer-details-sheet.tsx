"use client";

import { CalendarDays, CheckCircle2, Mail, MapPin, Pencil, Phone, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type {
  CustomerDetailPrototype,
  CustomerFittingHistoryPrototype,
  CustomerReservationHistoryPrototype,
} from "./customers-prototype-detail-data";

export function CustomerDetailsSheet({
  customer,
  mode,
  onEdit,
  onOpenChange,
}: {
  customer: CustomerDetailPrototype | null;
  mode: "view" | "edit";
  onEdit: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={customer !== null && mode === "view"} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {customer ? <CustomerDetails customer={customer} onEdit={onEdit} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function CustomerDetails({ customer, onEdit }: { customer: CustomerDetailPrototype; onEdit: () => void }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-14 sm:px-6">
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 border border-dashboard-border">
            <AvatarFallback className="bg-dashboard-active text-sm font-semibold text-dashboard-accent">
              {initials(customer.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-lg">{customer.full_name}</SheetTitle>
              <CustomerStatusBadge status={customer.status} />
            </div>
            <SheetDescription className="mt-1">
              Customer since {formatDate(customer.created_at)}
            </SheetDescription>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit Customer
          </Button>
        </div>
      </header>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <DetailSection title="Contact Information">
          <div className="grid gap-3 sm:grid-cols-2">
            <ContactItem icon={Phone} label="Phone" value={customer.phone ?? "Not provided"} />
            <ContactItem icon={Mail} label="Email" value={customer.email ?? "Not provided"} />
            <ContactItem icon={MapPin} label="Address" value={customer.address ?? "Not provided"} />
            <ContactItem icon={UserRound} label="Social media" value={customer.social_media ?? "Not provided"} />
          </div>
        </DetailSection>

        <Separator />

        <DetailSection title="Customer Summary">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <SummaryValue label="Reservations" value={customer.reservation_count} />
            <SummaryValue label="Fittings" value={customer.fitting_count} />
            <SummaryValue label="Completed" value={customer.completed_engagement_count} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ActivitySummary label="Last activity" activity={customer.last_activity} fallback="No activity yet" />
            <ActivitySummary label="Next activity" activity={customer.next_activity} fallback="None scheduled" />
          </div>
        </DetailSection>

        <Separator />

        <ReservationHistory reservations={customer.reservation_history} />

        <Separator />

        <FittingHistory fittings={customer.fitting_history} />

        <Separator />

        <DetailSection title="Internal Notes">
          <Card className="gap-0 py-0">
            <CardContent className="p-4 text-sm leading-6 text-dashboard-muted">
              {customer.notes ?? "No internal notes for this customer."}
            </CardContent>
          </Card>
        </DetailSection>
      </div>
    </div>
  );
}

function ReservationHistory({ reservations }: { reservations: readonly CustomerReservationHistoryPrototype[] }) {
  return (
    <DetailSection title="Reservation History">
      {reservations.length === 0 ? (
        <EmptyHistory label="No reservation history yet." />
      ) : (
        <div className="space-y-2">
          {reservations.slice(0, 3).map((reservation) => (
            <Card key={reservation.id} className="gap-0 py-0">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-dashboard-navy">{reservation.clothing_name}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">{reservation.reference}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{reservation.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-dashboard-muted sm:grid-cols-2">
                  <p>Pickup: {formatDateTime(reservation.pickup_at)}</p>
                  <p>Return: {formatDateTime(reservation.return_at)}</p>
                </div>
                <p className="mt-2 text-sm font-medium text-dashboard-navy">
                  {formatMoney(reservation.rental_amount, reservation.currency)}
                </p>
              </CardContent>
            </Card>
          ))}
          {reservations.length > 3 ? (
            <Button type="button" variant="ghost" size="sm" disabled>
              Load more in production
            </Button>
          ) : null}
        </div>
      )}
    </DetailSection>
  );
}

function FittingHistory({ fittings }: { fittings: readonly CustomerFittingHistoryPrototype[] }) {
  return (
    <DetailSection title="Fitting History">
      {fittings.length === 0 ? (
        <EmptyHistory label="No fitting history yet." />
      ) : (
        <div className="space-y-2">
          {fittings.slice(0, 3).map((fitting) => (
            <Card key={fitting.id} className="gap-0 py-0">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-dashboard-navy">{formatDateTime(fitting.starts_at)}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">
                      {fitting.garment_summary ?? "No garment preference recorded"}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">{fitting.status.replace("_", " ")}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dashboard-muted">
                  <span>{formatMoney(fitting.fee_amount, fitting.currency)} fitting fee</span>
                  <span className="capitalize">Payment: {fitting.payment_status}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {fittings.length > 3 ? (
            <Button type="button" variant="ghost" size="sm" disabled>
              Load more in production
            </Button>
          ) : null}
        </div>
      )}
    </DetailSection>
  );
}

function DetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-dashboard-navy">{title}</h2>
      {children}
    </section>
  );
}

function ContactItem({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashboard-border p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-dashboard-muted">{label}</p>
        <p className="mt-1 break-words text-sm font-medium text-dashboard-navy">{value}</p>
      </div>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-dashboard-border p-3">
      <p className="text-lg font-semibold text-dashboard-navy">{value}</p>
      <p className="mt-1 text-xs text-dashboard-muted">{label}</p>
    </div>
  );
}

function ActivitySummary({ activity, fallback, label }: { activity: CustomerDetailPrototype["last_activity"]; fallback: string; label: string }) {
  return (
    <div className="rounded-lg border border-dashboard-border p-3">
      <p className="text-xs text-dashboard-muted">{label}</p>
      {activity ? (
        <p className="mt-1 text-sm font-medium capitalize text-dashboard-navy">
          {activity.type} · {formatDateTime(activity.at)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-dashboard-muted">{fallback}</p>
      )}
    </div>
  );
}

function EmptyHistory({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-dashboard-border px-3 py-4 text-sm text-dashboard-muted">
      <CalendarDays className="h-4 w-4" aria-hidden="true" />
      {label}
    </div>
  );
}

export function CustomerStatusBadge({ status }: { status: CustomerDetailPrototype["status"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        status === "active"
          ? "dashboard-tone-mint border-transparent"
          : "border-dashboard-border bg-dashboard-canvas text-dashboard-muted"
      )}
    >
      {status === "active" ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : null}
      {status === "active" ? "Active" : "Archived"}
    </Badge>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(amount));
}
