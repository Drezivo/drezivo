"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Layers3,
  Package,
  RefreshCw,
  Ruler,
  Shirt,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ClothingDetail, ClothingVariantDetail, PhysicalAssetSummary } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "ready"; item: ClothingDetail };

export function ClothingDetailsPage({ productId }: { productId: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const loadDetail = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setState({ kind: "loading" });
    try {
      const result = await createDrezivoApiClient(getToken).getCatalogueClothingDetail(productId);
      setState({ kind: "ready", item: result.data });
    } catch (error) {
      setState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [getToken, isLoaded, isSignedIn, productId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!isLoaded || !isSignedIn || state.kind === "loading") {
    return <DetailLoadingState />;
  }

  if (state.kind === "error") {
    return <DetailErrorState error={state.error} onRetry={loadDetail} />;
  }

  return <DetailContent item={state.item} />;
}

function DetailContent({ item }: { item: ClothingDetail }) {
  const allAssets = useMemo(() => item.variants.flatMap((variant) => variant.assets), [item.variants]);
  const activeAssets = allAssets.filter((asset) => asset.lifecycle_status === "active");
  const readyAssets = activeAssets.filter((asset) => asset.readiness === "ready");
  const sizes = [...new Set(item.variants.map((variant) => variant.size_label))];
  const priceRange = formatPriceRange(item.variants);
  const primaryImage = item.images.find((image) => image.image_url)?.image_url ?? null;

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
            <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
              <div className="flex min-h-60 items-center justify-center overflow-hidden rounded-2xl border border-dashboard-border bg-dashboard-active">
                {primaryImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- API-provided catalogue URLs are not yet configured for next/image remote patterns.
                  <img src={primaryImage} alt={item.name} className="h-full min-h-60 w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-dashboard-surface text-2xl font-semibold text-dashboard-accent shadow-sm">
                      {initialsFor(item.name)}
                    </span>
                    <p className="mt-3 text-xs text-dashboard-muted">No catalogue photo available</p>
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {item.category ? (
                    <span className="inline-flex rounded-full border border-dashboard-border bg-dashboard-active px-2.5 py-1 text-xs font-medium text-dashboard-accent">
                      {item.category.name}
                    </span>
                  ) : null}
                  <LifecycleBadge status={item.status} />
                </div>
                <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
                  {item.name}
                </h1>
                <p className="mt-1 text-sm text-dashboard-muted">{item.code}</p>
                <p className="mt-4 text-xl font-semibold text-dashboard-navy">{priceRange}</p>
                {item.description ? (
                  <p className="mt-5 max-w-3xl text-sm leading-6 text-dashboard-muted">{item.description}</p>
                ) : (
                  <p className="mt-5 text-sm text-dashboard-muted">No description added.</p>
                )}

                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryStat icon={Shirt} label="Sizes" value={sizes.length ? sizes.join(" · ") : "—"} />
                  <SummaryStat icon={Layers3} label="Variants" value={String(item.variants.length)} />
                  <SummaryStat icon={Package} label="Active Pieces" value={String(activeAssets.length)} />
                  <SummaryStat icon={Ruler} label="Ready Pieces" value={String(readyAssets.length)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <SectionCard
          icon={Shirt}
          title="Variants & Pricing"
          description="Each variant keeps its own size, color, pricing, and measurement source."
        >
          {item.variants.length === 0 ? (
            <EmptySection message="No variants are configured for this clothing style." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-dashboard-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-dashboard-active/40 hover:bg-dashboard-active/40">
                    <TableHead>Size</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Rental Price</TableHead>
                    <TableHead>Deposit</TableHead>
                    <TableHead>Measurements</TableHead>
                    <TableHead>Pieces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.variants.map((variant) => (
                    <TableRow key={variant.id}>
                      <TableCell className="font-semibold text-dashboard-navy">{variant.size_label}</TableCell>
                      <TableCell className="text-dashboard-muted">{variant.color_label ?? "—"}</TableCell>
                      <TableCell className="text-dashboard-muted">{variant.sku}</TableCell>
                      <TableCell className="font-medium text-dashboard-navy">
                        {formatMoney(variant.rental_price_minor, variant.currency)}
                        {variant.pricing_mode === "daily" ? " / day" : ""}
                      </TableCell>
                      <TableCell className="text-dashboard-muted">
                        {formatMoney(variant.security_deposit_minor, variant.currency)}
                      </TableCell>
                      <TableCell className="text-dashboard-muted">{measurementLabel(variant)}</TableCell>
                      <TableCell className="text-dashboard-muted">{variant.assets.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <SectionCard
            icon={Package}
            title="Serialized Pieces"
            description="Readiness and custody describe each physical garment now; they do not replace future allocation checks."
          >
            {allAssets.length === 0 ? (
              <EmptySection message="No physical pieces are attached to this clothing style in the active branch." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-dashboard-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-dashboard-active/40 hover:bg-dashboard-active/40">
                      <TableHead>Piece</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Lifecycle</TableHead>
                      <TableHead>Readiness</TableHead>
                      <TableHead>Custody</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.variants.flatMap((variant) =>
                      variant.assets.map((asset) => (
                        <TableRow key={asset.id}>
                          <TableCell className="font-medium text-dashboard-navy">{asset.asset_code}</TableCell>
                          <TableCell className="text-dashboard-muted">{variant.size_label}</TableCell>
                          <TableCell><StatusBadge label={labelize(asset.lifecycle_status)} /></TableCell>
                          <TableCell><ReadinessBadge readiness={asset.readiness} /></TableCell>
                          <TableCell className="text-dashboard-muted">{labelize(asset.custody_kind)}</TableCell>
                          <TableCell className="max-w-64 text-dashboard-muted">
                            {asset.condition_note ?? asset.alteration_note ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-dashboard-navy">Catalogue</h2>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <DetailPair label="Category" value={item.category?.name ?? "Uncategorized"} />
                  <DetailPair label="Status" value={labelize(item.status)} />
                  <DetailPair label="Created" value={formatDateTime(item.created_at)} />
                  <DetailPair label="Last updated" value={formatDateTime(item.updated_at)} />
                </dl>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-dashboard-navy">Upcoming Blocks</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-dashboard-muted">
                  Bounded upcoming allocation references for this clothing style.
                </p>
                {item.upcoming_allocations.length === 0 ? (
                  <p className="mt-4 text-sm text-dashboard-muted">No upcoming blocking allocations.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {item.upcoming_allocations.map((allocation, index) => (
                      <div
                        key={`${allocation.asset_id}-${allocation.starts_at}-${index}`}
                        className="rounded-xl border border-dashboard-border bg-dashboard-active/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-dashboard-navy">
                            {allocationLabel(allocation.kind)}
                          </span>
                          <span className="text-[0.68rem] text-dashboard-muted">#{index + 1}</span>
                        </div>
                        <p className="mt-2 text-xs text-dashboard-muted">
                          {formatDateTime(allocation.starts_at)}
                        </p>
                        <p className="mt-0.5 text-xs text-dashboard-muted">
                          to {formatDateTime(allocation.ends_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {item.has_more_upcoming_allocations ? (
                  <p className="mt-3 text-xs text-dashboard-muted">
                    More upcoming allocations exist. This detail response is intentionally bounded.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DetailLoadingState() {
  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-80 w-full max-w-screen-2xl items-center justify-center rounded-xl border border-dashboard-border bg-dashboard-surface text-sm text-dashboard-muted">
        Loading clothing details…
      </div>
    </div>
  );
}

function DetailErrorState({ error, onRetry }: { error: DrezivoApiError; onRetry: () => Promise<void> }) {
  const notFound = error.status === 404 || error.code === "NOT_FOUND";
  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-80 w-full max-w-screen-2xl flex-col items-center justify-center gap-4 rounded-xl border border-dashboard-border bg-dashboard-surface px-6 text-center">
        <CircleAlert className="h-8 w-8 text-dashboard-muted" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold text-dashboard-navy">
            {notFound ? "Clothing not found" : "Could not load clothing details"}
          </h1>
          <p className="mt-1 max-w-lg text-sm text-dashboard-muted">{error.message}</p>
          {error.requestId ? (
            <p className="mt-1 text-xs text-dashboard-muted">Support reference: {error.requestId}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/inventory"
            className="inline-flex h-10 items-center justify-center rounded-md border border-dashboard-border px-4 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active"
          >
            Back to Clothing
          </Link>
          {!notFound ? (
            <Button type="button" onClick={() => void onRetry()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
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

function DetailPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-dashboard-muted">{label}</dt>
      <dd className="text-right font-medium text-dashboard-navy">{value}</dd>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-dashboard-border px-5 py-10 text-center text-sm text-dashboard-muted">
      {message}
    </div>
  );
}

function LifecycleBadge({ status }: { status: ClothingDetail["status"] }) {
  return (
    <Badge variant={status === "active" ? "secondary" : "outline"}>
      {labelize(status)}
    </Badge>
  );
}

function StatusBadge({ label }: { label: string }) {
  return <Badge variant="outline">{label}</Badge>;
}

function ReadinessBadge({ readiness }: { readiness: PhysicalAssetSummary["readiness"] }) {
  const className = cn(
    readiness === "ready" && "dashboard-tone-mint",
    readiness === "needs_cleaning" && "dashboard-tone-orange",
    readiness === "needs_repair" && "reservation-status-danger",
    readiness === "unready" && "bg-dashboard-neutral-soft text-dashboard-neutral-text"
  );
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", className)}>{labelize(readiness)}</span>;
}

function measurementLabel(variant: ClothingVariantDetail): string {
  if (variant.measurement_mode === "default_guide") return "Default guide";
  if (variant.measurement_mode === "none") return "None";
  const count = Object.keys(variant.measurements).length;
  return count > 0 ? `Custom · ${count} fields` : "Custom";
}

function formatPriceRange(variants: ClothingVariantDetail[]): string {
  if (variants.length === 0) return "No pricing configured";
  const values = variants.map((variant) => BigInt(variant.rental_price_minor));
  const minimum = values.reduce((a, b) => (a < b ? a : b));
  const maximum = values.reduce((a, b) => (a > b ? a : b));
  const currency = variants[0]?.currency ?? "PHP";
  const minimumLabel = formatMoney(minimum.toString(), currency);
  return minimum === maximum
    ? minimumLabel
    : `${minimumLabel}–${formatMoney(maximum.toString(), currency)}`;
}

function formatMoney(minor: string, currency: string): string {
  const amount = Number(BigInt(minor)) / 100;
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-PH")}`;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function allocationLabel(kind: ClothingDetail["upcoming_allocations"][number]["kind"]): string {
  if (kind === "reservation_hold") return "Reservation hold";
  if (kind === "reservation_confirmed") return "Confirmed reservation";
  return "Maintenance";
}

function labelize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "CL";
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not load this clothing item. Please try again.", { status: 500 });
}
