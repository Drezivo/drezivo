"use client";

import { useAuth } from "@clerk/nextjs";
import { Plus, Search, Shirt, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  ClothingDetail,
  ClothingListItem,
  InstantInterval,
  ProductId,
  ProductVariantId,
} from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { displaySizeLabel } from "@/lib/catalogue-display";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

const SEARCH_LIMIT = 5;
/** One booking holds at most this many garments, the main one included (API: MAX_RESERVATION_LINES). */
export const MAX_GARMENTS_PER_BOOKING = 10;

/** A garment to start with, such as one copied from an earlier booking by Continue. */
export function additionalGarmentFrom(input: { productId: ProductId; variantId: ProductVariantId; name: string }, index: number): AdditionalGarment {
  return {
    key: `${input.productId}-copied-${index}`,
    productId: input.productId,
    name: input.name,
    imageUrl: null,
    detail: null,
    variantId: input.variantId,
    availableAssets: null,
    checkedFor: null,
    error: null,
  };
}

/** A garment added to the booking next to the main one, with its own size and availability. */
export type AdditionalGarment = {
  key: string;
  productId: ProductId;
  name: string;
  imageUrl: string | null;
  detail: ClothingDetail | null;
  variantId: ProductVariantId | "";
  /** Free pieces of the chosen size for the booking's dates, from the live availability check. */
  availableAssets: number | null;
  checkedFor: string | null;
  error: string | null;
};

type Update = (update: (current: AdditionalGarment[]) => AdditionalGarment[]) => void;

/**
 * Whether the extra garments are ready to reserve with the main one. The same size can be booked
 * more than once only while the shop has that many free pieces, counting the main garment too.
 * The API re-checks everything when the booking is reserved.
 */
export function additionalGarmentsReadiness(
  garments: readonly AdditionalGarment[],
  primaryVariantId: ProductVariantId | "",
  intervalKey: string | null
): { ready: boolean; variantIds: ProductVariantId[]; problem: string | null } {
  const needed = new Map<string, number>();
  if (primaryVariantId) needed.set(primaryVariantId, 1);
  for (const garment of garments) {
    if (garment.variantId) needed.set(garment.variantId, (needed.get(garment.variantId) ?? 0) + 1);
  }
  for (const garment of garments) {
    if (!garment.variantId) return { ready: false, variantIds: [], problem: `Choose a size for ${garment.name}.` };
    if (garment.error) return { ready: false, variantIds: [], problem: garment.error };
    if (garment.checkedFor !== intervalKey || garment.availableAssets === null) {
      return { ready: false, variantIds: [], problem: `Checking ${garment.name} for these dates…` };
    }
    const need = needed.get(garment.variantId) ?? 1;
    if (garment.availableAssets < need) {
      return {
        ready: false,
        variantIds: [],
        problem:
          garment.availableAssets === 0
            ? `${garment.name} is not free for these dates.`
            : `Only ${garment.availableAssets} ${garment.name} in this size ${garment.availableAssets === 1 ? "is" : "are"} free for these dates.`,
      };
    }
  }
  return { ready: true, variantIds: garments.map((garment) => garment.variantId as ProductVariantId), problem: null };
}

export function AdditionalGarments({
  disabled,
  garments,
  onChange,
  requestedInterval,
}: {
  disabled: boolean;
  garments: AdditionalGarment[];
  onChange: Update;
  requestedInterval: InstantInterval | null;
}) {
  const { getToken } = useAuth();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [results, setResults] = useState<ClothingListItem[]>([]);
  const intervalKey = requestedInterval ? `${requestedInterval.start}|${requestedInterval.end}` : null;
  // Each size load and date check runs once; results are matched to the garment's current state
  // when they land, so an edit while a request is in flight never applies a stale answer.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getCatalogueClothing({
        limit: SEARCH_LIMIT,
        sort: debouncedSearch ? "name_asc" : "newest",
        product_status: "active",
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      })
      .then((result) => {
        if (!cancelled) setResults(result.data.items);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, getToken, picking]);

  // Load sizes for garments just added; a flexible-fit item has one size and is chosen for staff.
  useEffect(() => {
    const pending = garments.filter(
      (garment) => garment.detail === null && garment.error === null && !inFlight.current.has(`detail:${garment.key}`)
    );
    for (const garment of pending) {
      const flightKey = `detail:${garment.key}`;
      inFlight.current.add(flightKey);
      void createDrezivoApiClient(getToken)
        .getCatalogueClothingDetail(garment.productId)
        .then((result) => {
          const active = result.data.variants.filter((variant) => variant.status === "active");
          const onlySize = result.data.sizing_mode === "free_size" && active.length === 1 ? active[0] : undefined;
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key ? { ...item, detail: result.data, variantId: onlySize ? onlySize.id : item.variantId } : item
            )
          );
        })
        .catch(() => {
          onChange((current) =>
            current.map((item) => (item.key === garment.key ? { ...item, error: `Could not load ${garment.name}.` } : item))
          );
        })
        .finally(() => inFlight.current.delete(flightKey));
    }
  }, [garments, getToken, onChange]);

  // Check each chosen size against the booking's dates, again whenever the dates change.
  useEffect(() => {
    if (!requestedInterval || !intervalKey) return;
    const stale = garments.filter(
      (garment) =>
        garment.variantId &&
        garment.checkedFor !== intervalKey &&
        !inFlight.current.has(`check:${garment.key}:${garment.variantId}:${intervalKey}`)
    );
    for (const garment of stale) {
      const variantId = garment.variantId as ProductVariantId;
      const flightKey = `check:${garment.key}:${variantId}:${intervalKey}`;
      inFlight.current.add(flightKey);
      void createDrezivoApiClient(getToken)
        .getStaffReservationAvailabilityCheck({
          variant_id: variantId,
          pickup_at: requestedInterval.start,
          due_at: requestedInterval.end,
        })
        .then((result) => {
          const checkedFor = `${result.data.requested_interval.start}|${result.data.requested_interval.end}`;
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key && item.variantId === variantId
                ? { ...item, availableAssets: result.data.available_assets, checkedFor, error: null }
                : item
            )
          );
        })
        .catch(() => {
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key && item.variantId === variantId
                ? { ...item, checkedFor: intervalKey, error: `Could not check ${garment.name} for these dates.` }
                : item
            )
          );
        })
        .finally(() => inFlight.current.delete(flightKey));
    }
  }, [garments, getToken, intervalKey, onChange, requestedInterval]);

  const add = (product: ClothingListItem) => {
    onChange((current) => [
      ...current,
      {
        key: `${product.product_id}-${Date.now()}-${current.length}`,
        productId: product.product_id,
        name: product.name,
        imageUrl: product.primary_image_url,
        detail: null,
        variantId: "",
        availableAssets: null,
        checkedFor: null,
        error: null,
      },
    ]);
    setPicking(false);
    setSearch("");
  };

  const full = garments.length + 1 >= MAX_GARMENTS_PER_BOOKING;
  return (
    <div className="space-y-3">
      {garments.map((garment) => {
        const sizes = garment.detail?.variants.filter((variant) => variant.status === "active") ?? [];
        return (
          <div key={garment.key} className="rounded-lg border border-dashboard-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-dashboard-active text-dashboard-accent">
                  {garment.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed catalogue URLs are dynamic.
                    <img src={garment.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Shirt className="h-4 w-4" aria-hidden="true" />
                  )}
                </div>
                <p className="truncate font-medium text-dashboard-navy">{garment.name}</p>
              </div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${garment.name} from this booking`}
                onClick={() => onChange((current) => current.filter((item) => item.key !== garment.key))}
                className="rounded-md p-1 text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {garment.detail && garment.detail.sizing_mode !== "free_size" ? (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${garment.name} size`}>
                {sizes.map((variant) => (
                  <Button
                    key={variant.id}
                    type="button"
                    size="sm"
                    disabled={disabled}
                    variant={garment.variantId === variant.id ? "default" : "secondary"}
                    onClick={() =>
                      onChange((current) =>
                        current.map((item) =>
                          item.key === garment.key
                            ? { ...item, variantId: variant.id, availableAssets: null, checkedFor: null, error: null }
                            : item
                        )
                      )
                    }
                  >
                    {displaySizeLabel(variant.size_label)}
                    {variant.color_label ? ` · ${variant.color_label}` : ""}
                  </Button>
                ))}
              </div>
            ) : null}
            <GarmentStatus garment={garment} intervalKey={intervalKey} />
          </div>
        );
      })}

      {picking ? (
        <div className="rounded-lg border border-dashboard-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted" aria-hidden="true" />
            <Input
              className="pl-9"
              aria-label="Search clothing to add"
              placeholder="Search clothing name or code..."
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="mt-2 grid gap-1.5">
            {results.map((product) => (
              <button
                key={product.product_id}
                type="button"
                aria-label={`Add ${product.name}`}
                onClick={() => add(product)}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-dashboard-active"
              >
                <span className="truncate text-dashboard-navy">{product.name}</span>
                <span className="shrink-0 text-xs text-dashboard-muted">{product.code}</span>
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setPicking(false)}>
            Done
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" disabled={disabled || full} onClick={() => setPicking(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {full ? `Up to ${MAX_GARMENTS_PER_BOOKING} pieces per booking` : "Add another dress"}
        </Button>
      )}
    </div>
  );
}

function GarmentStatus({ garment, intervalKey }: { garment: AdditionalGarment; intervalKey: string | null }) {
  if (garment.error) return <p className="mt-2 text-xs text-dashboard-danger">{garment.error}</p>;
  if (!garment.detail) return <p className="mt-2 text-xs text-dashboard-muted">Loading sizes…</p>;
  if (!garment.variantId) return <p className="mt-2 text-xs text-dashboard-muted">Choose a size.</p>;
  if (!intervalKey) return <p className="mt-2 text-xs text-dashboard-muted">Choose the rental dates to check this piece.</p>;
  if (garment.checkedFor !== intervalKey || garment.availableAssets === null) {
    return <p className="mt-2 text-xs text-dashboard-muted">Checking these dates…</p>;
  }
  return (
    <p className={cn("mt-2 text-xs", garment.availableAssets > 0 ? "text-dashboard-green-text" : "text-dashboard-danger")}>
      {garment.availableAssets > 0
        ? `${garment.availableAssets} free ${garment.availableAssets === 1 ? "piece" : "pieces"} for these dates`
        : "Not free for these dates"}
    </p>
  );
}
