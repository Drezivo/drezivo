"use client";

import {
  CalendarCheck2,
  ChevronDown,
  Repeat2,
  Search,
  UserPlus,
  UsersRound,
  X,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  CUSTOMER_DASHBOARD_SUMMARY_PROTOTYPE,
  CUSTOMER_LIST_PROTOTYPE,
  type CustomerActivityPrototype,
  type CustomerDashboardSummaryPrototype,
  type CustomerListItemPrototype,
} from "./customers-prototype-data";

type CustomerStatusFilter = "active" | "archived" | "all";

const CUSTOMER_STATUS_LABELS: Record<CustomerStatusFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "All customers",
};

const SUMMARY_ITEMS = [
  {
    key: "all_customers",
    label: "All Customers",
    icon: UsersRound,
    tone: "dashboard-tone-blue",
  },
  {
    key: "new_this_month",
    label: "New This Month",
    icon: UserPlus,
    tone: "dashboard-tone-mint",
  },
  {
    key: "returning_customers",
    label: "Returning Customers",
    icon: Repeat2,
    tone: "dashboard-tone-orange",
  },
  {
    key: "upcoming_customers",
    label: "Upcoming Customers",
    icon: CalendarCheck2,
    tone: "dashboard-tone-purple",
  },
] as const;

export function CustomersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CustomerStatusFilter>("active");
  const hasActiveFilters = Boolean(query.trim() || status !== "active");

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return CUSTOMER_LIST_PROTOTYPE.filter((customer) => {
      const statusMatches = status === "all" || customer.status === status;
      if (!statusMatches) return false;
      if (!normalizedQuery) return true;

      return [customer.full_name, customer.phone ?? "", customer.email ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [query, status]);

  const clearFilters = () => {
    setQuery("");
    setStatus("active");
  };

  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <section aria-labelledby="customers-heading">
          <h1 id="customers-heading" className="text-2xl font-bold tracking-tight text-dashboard-navy">
            Customers
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            View customer profiles and their reservation and fitting activity.
          </p>
        </section>

        <CustomerSummarySection summary={CUSTOMER_DASHBOARD_SUMMARY_PROTOTYPE} />

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            <CustomerToolbar
              query={query}
              status={status}
              hasActiveFilters={hasActiveFilters}
              onQueryChange={setQuery}
              onStatusChange={setStatus}
              onClearFilters={clearFilters}
            />
            <CustomersTable customers={filteredCustomers} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CustomerSummarySection({
  summary,
}: {
  summary: CustomerDashboardSummaryPrototype;
}) {
  return (
    <section aria-label="Customer overview" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {SUMMARY_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.key} className="gap-0 py-0">
            <CardContent className="flex min-h-20 items-center gap-3 p-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  item.tone
                )}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                  {summary[item.key]}
                </span>
                <span className="mt-1 block text-xs text-dashboard-muted">{item.label}</span>
              </span>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function CustomerToolbar({
  hasActiveFilters,
  onClearFilters,
  onQueryChange,
  onStatusChange,
  query,
  status,
}: {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: CustomerStatusFilter) => void;
  query: string;
  status: CustomerStatusFilter;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-3 sm:p-4 xl:flex-row xl:items-end">
      <label className="relative min-w-0 flex-1 xl:max-w-xl">
        <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Search customers</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-dashboard-muted"
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search name, phone, or email..."
          className="pl-9"
        />
      </label>

      <div className="min-w-0 sm:min-w-40">
        <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Status</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Status: ${CUSTOMER_STATUS_LABELS[status]}`}
              className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active sm:min-w-40"
            >
              <span className="truncate">{CUSTOMER_STATUS_LABELS[status]}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {(Object.entries(CUSTOMER_STATUS_LABELS) as Array<[CustomerStatusFilter, string]>).map(
              ([value, label]) => (
                <DropdownMenuItem key={value} onSelect={() => onStatusChange(value)}>
                  {label}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasActiveFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onClearFilters}
          className="shrink-0 text-dashboard-muted hover:text-dashboard-navy"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function CustomersTable({ customers }: { customers: readonly CustomerListItemPrototype[] }) {
  if (customers.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="font-semibold text-dashboard-navy">No customers match these filters</p>
        <p className="mt-1 text-sm text-dashboard-muted">
          Adjust the customer search or status filter to see other profiles.
        </p>
      </div>
    );
  }

  return (
    <Table aria-label="Customers">
      <TableHeader>
        <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
          <TableHead className="pl-4">Customer</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead className="text-center">Reservations</TableHead>
          <TableHead className="text-center">Fittings</TableHead>
          <TableHead className="hidden lg:table-cell">Last Activity</TableHead>
          <TableHead className="hidden xl:table-cell">Next Activity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-4 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell className="pl-4 align-top">
              <div className="flex items-start gap-3">
                <Avatar className="h-9 w-9 border border-dashboard-border">
                  <AvatarFallback className="bg-dashboard-active text-xs font-semibold text-dashboard-accent">
                    {initials(customer.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="max-w-52 truncate font-semibold text-dashboard-navy">
                    {customer.full_name}
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    Customer since {formatCustomerSince(customer.created_at)}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top">
              <div className="space-y-1">
                <p className="max-w-52 truncate font-medium text-dashboard-navy">
                  {customer.phone ?? "No phone"}
                </p>
                <p className="max-w-52 truncate text-xs text-dashboard-muted">
                  {customer.email ?? "No email"}
                </p>
              </div>
            </TableCell>
            <TableCell className="text-center align-top font-medium text-dashboard-navy">
              {customer.reservation_count}
            </TableCell>
            <TableCell className="text-center align-top font-medium text-dashboard-navy">
              {customer.fitting_count}
            </TableCell>
            <TableCell className="hidden align-top lg:table-cell">
              <ActivityCell activity={customer.last_activity} fallback="No activity yet" />
            </TableCell>
            <TableCell className="hidden align-top xl:table-cell">
              <ActivityCell activity={customer.next_activity} fallback="None scheduled" />
            </TableCell>
            <TableCell className="align-top">
              <Badge
                variant="outline"
                className={cn(
                  "font-medium",
                  customer.status === "active"
                    ? "dashboard-tone-mint border-transparent"
                    : "border-dashboard-border bg-dashboard-canvas text-dashboard-muted"
                )}
              >
                {customer.status === "active" ? "Active" : "Archived"}
              </Badge>
            </TableCell>
            <TableCell className="pr-4 text-right align-top text-dashboard-muted" aria-label="Actions pending">
              —
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActivityCell({
  activity,
  fallback,
}: {
  activity: CustomerActivityPrototype | null;
  fallback: string;
}) {
  if (!activity) return <span className="text-xs text-dashboard-muted">{fallback}</span>;

  return (
    <div>
      <p className="font-medium capitalize text-dashboard-navy">{activity.type}</p>
      <p className="mt-1 text-xs text-dashboard-muted">{formatActivityDateTime(activity.at)}</p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatCustomerSince(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatActivityDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
