"use client";

import {
  Archive,
  CalendarDays,
  ChevronRight,
  Clock3,
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Ruler,
  Shirt,
  Sparkles,
  Tags,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useMeasurementGuide } from "@/components/settings/measurement-guide-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { ClothingItem } from "./clothing-data";

type RentalHistoryItem = {
  id: string;
  customer: string;
  period: string;
  size: string;
  amount: string;
  status: "Completed" | "Returned";
};

type MaintenanceItem = {
  id: string;
  piece: string;
  title: string;
  detail: string;
  date: string;
  kind: "cleaning" | "inspection" | "repair";
};

export function ClothingDetailsPage({ item }: { item: ClothingItem }) {
  const { guide } = useMeasurementGuide();
  const [guideOpen, setGuideOpen] = useState(false);
  const variants = buildVariants(item);
  const rentalHistory = buildRentalHistory(item);
  const maintenanceHistory = buildMaintenanceHistory(item);

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/inventory" className="text-dashboard-muted transition-colors hover:text-dashboard-navy">
            Clothing
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-dashboard-muted" aria-hidden="true" />
          <span className="font-medium text-dashboard-navy">{item.name}</span>
        </div>

        <Card className="gap-0 py-0">
          <CardContent className="p-4 sm:p-5 lg:p-6">
            <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)_auto] lg:items-start">
              <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashboard-border bg-dashboard-active">
                <div className="text-center">
                  <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-dashboard-surface text-2xl font-semibold text-dashboard-accent shadow-sm">
                    {item.initials}
                  </span>
                  <p className="mt-3 text-xs text-dashboard-muted">Primary clothing photo</p>
                </div>
              </div>

              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-dashboard-border bg-dashboard-active px-2.5 py-1 text-xs font-medium text-dashboard-accent">
                  {item.category}
                </span>
                <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
                  {item.name}
                </h1>
                <p className="mt-1 text-sm text-dashboard-muted">{item.code}</p>
                <p className="mt-4 text-xl font-semibold text-dashboard-navy">{formatPrice(item)}</p>
                <p className="mt-1 text-xs text-dashboard-muted">
                  Pricing is summarized from the size variants below.
                </p>
                <p className="mt-5 max-w-2xl text-sm leading-6 text-dashboard-muted">
                  A rental clothing style managed across its available sizes. Variant pricing and measurements stay separate, while each selected size maps to one initial physical piece in V1.
                </p>

                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryStat icon={Shirt} label="Sizes" value={item.sizes.join(" · ")} />
                  <SummaryStat icon={Tags} label="Category" value={item.category} />
                  <SummaryStat icon={Sparkles} label="Total Pieces" value={String(item.physicalUnits)} />
                  <SummaryStat icon={Ruler} label="Measurements" value="Shared guide" />
                </div>
              </div>

              <div className="flex gap-2 lg:justify-end">
                <Button variant="secondary">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More clothing actions" className="border border-dashboard-border bg-dashboard-surface">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Archive className="mr-2 h-4 w-4" />
                      {item.archived ? "Restore clothing" : "Archive clothing"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="space-y-4">
            <SectionCard
              icon={Shirt}
              title="Variants & Pricing"
              description="Sizes are separate variants, but shared values do not need to be re-entered for every size."
            >
              <div className="overflow-x-auto rounded-xl border border-dashboard-border">
                <div className="min-w-[42rem]">
                  <div className="grid grid-cols-[5rem_1fr_1fr_1.1fr_1fr] border-b border-dashboard-border bg-dashboard-active/40 px-4 py-2 text-xs font-medium text-dashboard-muted">
                    <span>Size</span>
                    <span>Color</span>
                    <span>Pricing</span>
                    <span>Measurements</span>
                    <span>Piece</span>
                  </div>
                  {variants.map((variant) => (
                    <div
                      key={variant.size}
                      className="grid grid-cols-[5rem_1fr_1fr_1.1fr_1fr] items-center border-b border-dashboard-border px-4 py-3 text-sm last:border-b-0"
                    >
                      <span className="font-semibold text-dashboard-navy">{variant.size}</span>
                      <span className="text-dashboard-muted">Black</span>
                      <span className="font-medium text-dashboard-navy">{variant.price}</span>
                      <span className="text-dashboard-muted">{variant.measurementLabel}</span>
                      <span className="text-dashboard-muted">{variant.assetCode}</span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon={History}
              title="Rental History"
              description="Completed and returned rentals for this clothing style. Current reservations remain in Reservations."
            >
              <div className="divide-y divide-dashboard-border rounded-xl border border-dashboard-border">
                {rentalHistory.map((rental) => (
                  <div key={rental.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_1fr_auto] sm:items-center">
                    <div>
                      <p className="text-sm font-semibold text-dashboard-navy">{rental.customer}</p>
                      <p className="mt-1 text-xs text-dashboard-muted">{rental.id} · Size {rental.size}</p>
                    </div>
                    <div>
                      <p className="text-sm text-dashboard-navy">{rental.period}</p>
                      <p className="mt-1 text-xs text-dashboard-muted">{rental.amount}</p>
                    </div>
                    <span className="inline-flex w-fit rounded-full bg-dashboard-green-soft px-2.5 py-1 text-xs font-medium text-dashboard-green-text">
                      {rental.status}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl dashboard-tone-blue">
                    <Ruler className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-dashboard-navy">Measurement Guide</h2>
                    <p className="mt-1 truncate text-xs text-dashboard-muted">{guide.name}</p>
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-dashboard-muted">
                  Most variants use the business&apos;s shared guide. Only exceptions need custom structured measurements.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setGuideOpen(true)}
                  className="mt-4 w-full border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  View Measurement
                </Button>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-dashboard-navy">Maintenance & Cleaning</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {maintenanceHistory.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-dashboard-border bg-dashboard-active/30 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-dashboard-navy">{entry.title}</p>
                          <p className="mt-1 text-xs text-dashboard-muted">{entry.piece}</p>
                        </div>
                        <span className={cn(
                          "rounded-full px-2 py-1 text-[0.65rem] font-medium",
                          entry.kind === "cleaning" && "dashboard-tone-mint",
                          entry.kind === "inspection" && "dashboard-tone-blue",
                          entry.kind === "repair" && "dashboard-tone-orange"
                        )}>
                          {entry.kind === "cleaning" ? "Cleaning" : entry.kind === "inspection" ? "Inspection" : "Repair"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-dashboard-muted">{entry.detail}</p>
                      <p className="mt-2 text-[0.68rem] text-dashboard-muted">{entry.date}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-dashboard-navy">Pieces</h2>
                <p className="mt-1 text-xs text-dashboard-muted">One initial piece per size in V1.</p>
                <div className="mt-4 divide-y divide-dashboard-border rounded-xl border border-dashboard-border">
                  {variants.map((variant) => (
                    <div key={variant.assetCode} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="text-xs font-medium text-dashboard-navy">Size {variant.size}</span>
                      <span className="text-xs text-dashboard-muted">{variant.assetCode}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Sheet open={guideOpen} onOpenChange={setGuideOpen}>
        <SheetContent className="w-[94vw] p-0 sm:max-w-lg">
          <div className="border-b border-dashboard-border px-5 py-4">
            <SheetTitle>{guide.name}</SheetTitle>
            <SheetDescription>Default measurement guide used by this clothing style.</SheetDescription>
          </div>
          <div className="p-5">
            {guide.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview is not compatible with next/image optimization.
              <img src={guide.previewUrl} alt={guide.name} className="w-full rounded-xl border border-dashboard-border object-contain" />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-dashboard-border bg-dashboard-active text-center">
                <Ruler className="h-10 w-10 text-dashboard-accent" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-dashboard-navy">Default measurement image preview</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-dashboard-muted">
                  Upload the shop&apos;s real guide from Settings to replace this placeholder.
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Shirt;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg dashboard-tone-blue">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-dashboard-navy">{title}</h2>
            <p className="mt-0.5 text-xs text-dashboard-muted">{description}</p>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SummaryStat({ icon: Icon, label, value }: { icon: typeof Shirt; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashboard-border bg-dashboard-active/35 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[0.68rem] text-dashboard-muted">{label}</p>
        <p className="truncate text-sm font-semibold text-dashboard-navy">{value}</p>
      </div>
    </div>
  );
}

function buildVariants(item: ClothingItem) {
  return item.sizes.map((size, index) => ({
    size,
    price:
      item.minPricePerDay === item.maxPricePerDay
        ? `₱${item.minPricePerDay.toLocaleString()} / day`
        : `₱${Math.round(item.minPricePerDay + ((item.maxPricePerDay - item.minPricePerDay) * index) / Math.max(1, item.sizes.length - 1)).toLocaleString()} / day`,
    measurementLabel: index === item.sizes.length - 1 && item.sizes.length > 2 ? "Custom" : "Default guide",
    assetCode: `${item.id}-${size}-001`,
  }));
}

function buildRentalHistory(item: ClothingItem): RentalHistoryItem[] {
  const customers = ["Maria Santos", "Anna Reyes", "Bea Cruz", "Daniel Lopez", "Carla Dela Cruz"];
  return customers.slice(0, Math.min(5, Math.max(3, item.sizes.length + 1))).map((customer, index) => ({
    id: `#R-${String(1400 + Number(item.id.slice(-3)) + index).padStart(5, "0")}`,
    customer,
    period: ["Aug 10 – 12, 2026", "Jul 5 – 7, 2026", "Jun 14 – 16, 2026", "May 3 – 5, 2026", "Apr 18 – 20, 2026"][index]!,
    size: item.sizes[index % item.sizes.length]!,
    amount: `₱${Math.round(item.minPricePerDay + index * 100).toLocaleString()} rental`,
    status: index % 2 === 0 ? "Completed" : "Returned",
  }));
}

function buildMaintenanceHistory(item: ClothingItem): MaintenanceItem[] {
  const first = item.sizes[0] ?? "M";
  const second = item.sizes[1] ?? first;
  const third = item.sizes[2] ?? second;
  return [
    {
      id: "clean-1",
      piece: `${item.id}-${first}-001`,
      title: "Cleaning completed",
      detail: "Standard post-rental cleaning recorded after return.",
      date: "Sep 10, 2026",
      kind: "cleaning",
    },
    {
      id: "inspect-1",
      piece: `${item.id}-${second}-001`,
      title: "Condition inspection",
      detail: "Returned in good condition; no alteration or repair required.",
      date: "Aug 13, 2026",
      kind: "inspection",
    },
    {
      id: "repair-1",
      piece: `${item.id}-${third}-001`,
      title: "Minor hem repair",
      detail: "Small hem adjustment completed and retained in maintenance history.",
      date: "Jul 9, 2026",
      kind: "repair",
    },
  ];
}

function formatPrice(item: ClothingItem) {
  const minimum = `₱${item.minPricePerDay.toLocaleString()}`;
  if (item.minPricePerDay === item.maxPricePerDay) return `${minimum} / day`;
  return `${minimum}–₱${item.maxPricePerDay.toLocaleString()} / day`;
}
