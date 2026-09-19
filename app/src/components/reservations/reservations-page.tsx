"use client";

import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  MoreHorizontal,
  NotebookText,
  PackageCheck,
  Search,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  RESERVATION_METRICS,
  RESERVATION_TABS,
  RESERVATIONS,
  type PaymentStatus,
  type ReservationRecord,
  type ReservationStatus,
} from "./reservations-data";

type ReservationTab = (typeof RESERVATION_TABS)[number]["label"];

const metricIcons = [CalendarDays, Shirt, Truck, Undo2, TriangleAlert] as const;

const metricToneClasses = {
  blue: "dashboard-tone-blue",
  mint: "dashboard-tone-mint",
  gold: "dashboard-tone-orange",
  danger: "bg-dashboard-danger/10 text-dashboard-danger",
} as const;

const statusClasses: Record<ReservationStatus, string> = {
  New: "reservation-status-new",
  "Pending Confirmation": "reservation-status-pending",
  Confirmed: "reservation-status-confirmed",
  "Picked Up": "reservation-status-picked-up",
  Returned: "reservation-status-returned",
  Completed: "reservation-status-completed",
  Cancelled: "reservation-status-cancelled",
  "Late Return": "reservation-status-danger",
};

const paymentClasses: Record<PaymentStatus, string> = {
  Paid: "reservation-status-confirmed",
  Pending: "reservation-status-pending",
  Failed: "reservation-status-danger",
};

export function ReservationsPage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ReservationTab>("All");
  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);

  const visibleReservations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return RESERVATIONS.filter((reservation) => {
      const matchesTab = activeTab === "All" || reservation.status === activeTab;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        reservation.id.toLowerCase().includes(normalizedQuery) ||
        reservation.customer.name.toLowerCase().includes(normalizedQuery) ||
        reservation.customer.phone.toLowerCase().includes(normalizedQuery) ||
        reservation.clothing.name.toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesQuery;
    });
  }, [activeTab, query]);

  return (
    <div className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <PageHeading />
        <MetricGrid />

        <Card className="gap-0 py-0">
          <CardContent className="p-0">
            <ReservationToolbar query={query} onQueryChange={setQuery} />
            <ReservationTabs activeTab={activeTab} onChange={setActiveTab} />
            <ReservationTable
              reservations={visibleReservations}
              onSelect={setSelectedReservation}
            />
            <ReservationPagination shown={visibleReservations.length} />
          </CardContent>
        </Card>
      </div>

      <ReservationDetailsSheet
        reservation={selectedReservation}
        onOpenChange={(open) => {
          if (!open) setSelectedReservation(null);
        }}
      />
    </div>
  );
}

function PageHeading() {
  return (
    <section aria-labelledby="reservations-heading">
      <h1
        id="reservations-heading"
        className="text-2xl font-bold tracking-tight text-dashboard-navy"
      >
        Reservations
      </h1>
      <p className="mt-1 text-sm text-dashboard-muted">
        Manage all customer reservations and keep track of their rental journey.
      </p>
    </section>
  );
}

function MetricGrid() {
  return (
    <section aria-label="Reservation overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {RESERVATION_METRICS.map((metric, index) => {
        const Icon = metricIcons[index] ?? CalendarDays;
        const attention = metric.tone === "danger";
        return (
          <Card
            key={metric.label}
            className={cn(
              "gap-0 py-0",
              attention && "border-dashboard-danger/30 bg-dashboard-danger/5"
            )}
          >
            <CardContent className="flex min-h-28 items-center gap-4 p-4">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  metricToneClasses[metric.tone]
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-dashboard-muted">{metric.label}</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-semibold leading-none text-dashboard-navy",
                    attention && "text-dashboard-danger"
                  )}
                >
                  {metric.value}
                </p>
                <p
                  className={cn(
                    "mt-2 text-xs text-dashboard-muted",
                    attention && "text-dashboard-danger"
                  )}
                >
                  {metric.description}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function ReservationToolbar({
  onQueryChange,
  query,
}: {
  onQueryChange: (value: string) => void;
  query: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-4 lg:flex-row lg:items-center">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search reservations</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by customer, reservation #, clothing, or phone..."
          className="pl-9"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem>Needs attention</DropdownMenuItem>
            <DropdownMenuItem>Paid reservations</DropdownMenuItem>
            <DropdownMenuItem>Self pickup</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Clear filters</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          <CalendarRange className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Sep 10, 2025 – Sep 30, 2025</span>
          <span className="sm:hidden">Date range</span>
        </Button>

        <Button
          variant="ghost"
          className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export
        </Button>
      </div>
    </div>
  );
}

function ReservationTabs({
  activeTab,
  onChange,
}: {
  activeTab: ReservationTab;
  onChange: (tab: ReservationTab) => void;
}) {
  return (
    <div className="border-b border-dashboard-border px-4 py-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Reservation status">
        {RESERVATION_TABS.map((tab) => {
          const selected = activeTab === tab.label;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.label)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                selected
                  ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                  : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
              )}
            >
              {tab.label} ({tab.count})
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReservationTable({
  onSelect,
  reservations,
}: {
  onSelect: (reservation: ReservationRecord) => void;
  reservations: readonly ReservationRecord[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 pl-4">
            <input
              type="checkbox"
              aria-label="Select all reservations"
              className="h-4 w-4 rounded border-dashboard-border accent-dashboard-accent"
            />
          </TableHead>
          <TableHead>Reservation #</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Clothing</TableHead>
          <TableHead>Rental Period</TableHead>
          <TableHead>Pickup / Return</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-4 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reservations.length === 0 ? (
          <TableRow>
            <TableCell colSpan={10} className="h-40 text-center text-dashboard-muted">
              No reservations match your current filters.
            </TableCell>
          </TableRow>
        ) : (
          reservations.map((reservation) => (
            <TableRow
              key={reservation.id}
              role="button"
              tabIndex={0}
              aria-label={`Open reservation ${reservation.id}`}
              onClick={() => onSelect(reservation)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(reservation);
                }
              }}
              className={cn(
                "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30",
                reservation.status === "Late Return" && "bg-dashboard-danger/5 hover:bg-dashboard-danger/10"
              )}
            >
              <TableCell className="pl-4" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select reservation ${reservation.id}`}
                  className="h-4 w-4 rounded border-dashboard-border accent-dashboard-accent"
                />
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-semibold text-dashboard-navy">#{reservation.id}</p>
                  <p className="mt-1 text-xs text-dashboard-muted">{reservation.createdAt.split(" · ")[0]}</p>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8 border border-dashboard-border">
                    <AvatarFallback className="bg-dashboard-active text-xs font-semibold text-dashboard-accent">
                      {reservation.customer.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-semibold text-dashboard-navy">{reservation.customer.name}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">{reservation.customer.phone}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">{reservation.customer.social}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
                    <Shirt className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-dashboard-navy">{reservation.clothing.name}</p>
                    <p className="mt-1 text-xs text-dashboard-muted">
                      {reservation.clothing.pricePerDay} × {reservation.clothing.quantity}
                    </p>
                    <p className="mt-1 text-xs text-dashboard-muted">Size {reservation.clothing.size}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <p className="font-medium text-dashboard-navy">{reservation.rentalPeriod}</p>
                <p className="mt-1 text-xs text-dashboard-muted">({reservation.duration})</p>
              </TableCell>
              <TableCell>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-dashboard-navy">{reservation.pickup.date}</span>
                    <span className="text-dashboard-muted">{reservation.pickup.time}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-dashboard-navy">{reservation.return.date}</span>
                    <span className="text-dashboard-muted">{reservation.return.time}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-dashboard-muted">{reservation.delivery}</TableCell>
              <TableCell>
                <StatusBadge label={reservation.payment.status} className={paymentClasses[reservation.payment.status]} />
              </TableCell>
              <TableCell>
                <StatusBadge label={reservation.status} className={statusClasses[reservation.status]} />
              </TableCell>
              <TableCell className="pr-4 text-right" onClick={(event) => event.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${reservation.id}`}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onSelect(reservation)}>View details</DropdownMenuItem>
                    <DropdownMenuItem>View customer</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>More actions</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ReservationPagination({ shown }: { shown: number }) {
  return (
    <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
      <p>Showing 1–{shown} of 48 reservations</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Previous page" disabled className="h-8 w-8">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          className="h-8 min-w-8 bg-dashboard-active px-2 text-dashboard-accent hover:bg-dashboard-active"
          aria-current="page"
        >
          1
        </Button>
        {[2, 3, 4, 5].map((page) => (
          <Button key={page} variant="ghost" className="h-8 min-w-8 px-2 text-dashboard-muted">
            {page}
          </Button>
        ))}
        <span className="px-1">…</span>
        <Button variant="ghost" className="h-8 min-w-8 px-2 text-dashboard-muted">
          6
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next page" className="h-8 w-8">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          className="ml-2 h-8 border border-dashboard-border bg-dashboard-surface px-3 text-dashboard-muted hover:bg-dashboard-active"
        >
          10 / page
        </Button>
      </div>
    </div>
  );
}

function ReservationDetailsSheet({
  onOpenChange,
  reservation,
}: {
  onOpenChange: (open: boolean) => void;
  reservation: ReservationRecord | null;
}) {
  return (
    <Sheet open={Boolean(reservation)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-lg lg:max-w-xl"
      >
        {reservation ? <ReservationDetails reservation={reservation} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ReservationDetails({ reservation }: { reservation: ReservationRecord }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-lg">Reservation #{reservation.id}</SheetTitle>
          <StatusBadge label={reservation.status} className={statusClasses[reservation.status]} />
        </div>
        <SheetDescription className="mt-1">Created {reservation.createdAt}</SheetDescription>

        <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button className="bg-dashboard-accent text-dashboard-canvas hover:bg-dashboard-accent/90">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            View Calendar
          </Button>
          <Button
            variant="ghost"
            className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            View Customer
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More reservation actions"
                className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Edit reservation</DropdownMenuItem>
              <DropdownMenuItem>Print summary</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Cancel reservation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <DetailCard title="Customer">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 border border-dashboard-border">
              <AvatarFallback className="bg-dashboard-active font-semibold text-dashboard-accent">
                {reservation.customer.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-dashboard-navy">{reservation.customer.name}</p>
              <p className="mt-1 text-xs text-dashboard-muted">{reservation.customer.phone}</p>
              <p className="mt-1 text-xs text-dashboard-muted">{reservation.customer.social}</p>
              <p className="mt-2 text-xs text-dashboard-muted">{reservation.customer.address}</p>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
          </div>
        </DetailCard>

        <DetailCard title="Rental Items (1)">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
              <Shirt className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-dashboard-navy">{reservation.clothing.name}</p>
              <p className="mt-1 text-xs text-dashboard-muted">
                Size {reservation.clothing.size} · {reservation.clothing.pricePerDay} / day
              </p>
              <p className="mt-1 text-xs text-dashboard-muted">Quantity: {reservation.clothing.quantity}</p>
              <button type="button" className="mt-2 text-xs font-medium text-dashboard-accent hover:underline">
                View clothing details
              </button>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-3 divide-x divide-dashboard-border">
            <DetailStat label="Rental Period" value={`${reservation.rentalPeriod}, 2025`} note={`(${reservation.duration})`} />
            <DetailStat label="Pickup" value={`${reservation.pickup.date}, ${reservation.pickup.time}`} />
            <DetailStat label="Return" value={`${reservation.return.date}, ${reservation.return.time}`} />
          </div>
        </DetailCard>

        <DetailListItem icon={Truck} label="Delivery Method" value={reservation.delivery} />

        <DetailListItem
          icon={CreditCard}
          label="Payment"
          value={`${reservation.payment.total} (${reservation.payment.detail})`}
          trailing={<StatusBadge label={reservation.payment.status} className={paymentClasses[reservation.payment.status]} />}
          action="View payment details"
        />

        <DetailListItem
          icon={ShieldCheck}
          label="Verification"
          value={reservation.verification}
          valueClassName={reservation.verification === "Completed" ? "text-dashboard-green-text" : undefined}
          action="View verification details"
        />

        <DetailListItem icon={NotebookText} label="Notes" value={reservation.notes} />

        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-dashboard-navy">Quick Actions</h3>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <QuickAction icon={PackageCheck} label="Mark as Picked Up" />
              <QuickAction icon={TriangleAlert} label="Cancel Reservation" />
              <QuickAction icon={MoreHorizontal} label="More Actions" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailCard({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-dashboard-navy">{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

function DetailStat({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="text-xs text-dashboard-muted">{label}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-dashboard-navy">{value}</p>
      {note ? <p className="mt-1 text-xs text-dashboard-muted">{note}</p> : null}
    </div>
  );
}

function DetailListItem({
  action,
  icon: Icon,
  label,
  trailing,
  value,
  valueClassName,
}: {
  action?: string;
  icon: typeof Truck;
  label: string;
  trailing?: React.ReactNode;
  value: string;
  valueClassName?: string | undefined;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-dashboard-muted">{label}</p>
          <p className={cn("mt-1 text-sm font-semibold text-dashboard-navy", valueClassName)}>{value}</p>
          {action ? (
            <button type="button" className="mt-2 text-xs font-medium text-dashboard-accent hover:underline">
              {action}
            </button>
          ) : null}
        </div>
        {trailing ?? <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />}
      </CardContent>
    </Card>
  );
}

function QuickAction({ icon: Icon, label }: { icon: typeof PackageCheck; label: string }) {
  return (
    <Button
      variant="ghost"
      className="h-auto min-h-20 flex-col whitespace-normal border border-dashboard-border bg-dashboard-surface px-2 py-3 text-center text-xs text-dashboard-navy hover:bg-dashboard-active"
    >
      <Icon className="h-5 w-5 text-dashboard-accent" strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}

function StatusBadge({ className, label }: { className: string; label: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap px-2 py-1 text-xs", className)}>
      {label}
    </Badge>
  );
}
