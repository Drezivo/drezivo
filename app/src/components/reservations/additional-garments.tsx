"use client";
import { StaffMediaImage } from "@/components/ui/staff-media-image";

import { useAuth } from "@clerk/nextjs";
import { Plus, Shirt, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import type {
  ClothingDetail,
  InstantInterval,
  ProductId,
  ProductVariantId,
  StaffReservationAvailabilityCalendarResponse,
  StaffReservationAvailabilityCheckResponse,
} from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { displaySizeLabel } from "@/lib/catalogue-display";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { mediaImageSrcSet } from "@/lib/media-image-srcset";
import { cn } from "@/lib/utils";
import { recoveryAvailabilityHint } from "./recovery-availability-hint";

/** One booking holds at most this many garments, the main one included (API: MAX_RESERVATION_LINES). */
export const MAX_GARMENTS_PER_BOOKING = 10;

/** A selected variant and its live availability for the dates currently shown. */
export type AdditionalGarment = {
  key: string;
  productId: ProductId;
  name: string;
  imageUrl: string | null;
  detail: ClothingDetail | null;
  variantId: ProductVariantId | "";
  availableAssets: number | null;
  availabilityCheck: StaffReservationAvailabilityCheckResponse | null;
  checkedFor: string | null;
  error: string | null;
};

type Update = (update: (current: AdditionalGarment[]) => AdditionalGarment[]) => void;

/** Shared peer-card presentation for every selected reservation line. */
export function SelectedGarmentCard({
  children,
  disabled,
  garment,
  onRemove,
  status,
}: {
  children?: ReactNode;
  disabled: boolean;
  garment: AdditionalGarment;
  onRemove: () => void;
  status: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-dashboard-active text-dashboard-accent">
            {garment.imageUrl ? (
              <StaffMediaImage src={garment.imageUrl} srcSet={mediaImageSrcSet(garment.imageUrl)} sizes="64px" alt="" className="h-full w-full object-cover" />
            ) : (
              <Shirt className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-dashboard-navy">{garment.name}</p>
            <p className="mt-1 text-xs text-dashboard-muted">
              {selectedVariantLabel(garment)}
              {variantPrice(garment)}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Remove ${garment.name} · ${selectedVariantLabel(garment)} from this booking`}
          onClick={onRemove}
          className="rounded-md p-1 text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {garment.detail?.sizing_mode === "free_size" ? (
        <p className="mt-3 text-xs text-dashboard-muted">One flexible-fit garment</p>
      ) : null}
      {children}
      {status}
    </div>
  );
}

/**
 * Readiness for the secondary selected lines. The primary line is checked separately by the
 * exact-availability request. Variant uniqueness is enforced here as an early UI guard and again
 * by the contracts and API at the reservation boundary.
 */
export function additionalGarmentsReadiness(
  garments: readonly AdditionalGarment[],
  primaryVariantId: ProductVariantId | "",
  intervalKey: string | null
): { ready: boolean; variantIds: ProductVariantId[]; problem: string | null } {
  const selected = new Set<string>(primaryVariantId ? [primaryVariantId] : []);
  for (const garment of garments) {
    if (!garment.variantId)
      return { ready: false, variantIds: [], problem: `Choose a size for ${garment.name}.` };
    if (selected.has(garment.variantId)) {
      return {
        ready: false,
        variantIds: [],
        problem: `${garment.name} has a variant already selected. Choose a different size.`,
      };
    }
    selected.add(garment.variantId);
  }

  if (selected.size > MAX_GARMENTS_PER_BOOKING) {
    return {
      ready: false,
      variantIds: [],
      problem: `A reservation can include up to ${MAX_GARMENTS_PER_BOOKING} garments.`,
    };
  }

  for (const garment of garments) {
    if (garment.error) return { ready: false, variantIds: [], problem: garment.error };
    if (garment.checkedFor !== intervalKey || garment.availableAssets === null) {
      return { ready: false, variantIds: [], problem: `Checking ${garment.name} for these dates…` };
    }
    if (garment.availableAssets < 1) {
      const variantLabel = selectedVariantLabel(garment);
      const itemLabel =
        variantLabel === "Choose a size" ? garment.name : `${garment.name} · ${variantLabel}`;
      return {
        ready: false,
        variantIds: [],
        problem: `${itemLabel} is not available for these dates.`,
      };
    }
  }
  return {
    ready: true,
    variantIds: garments.map((garment) => garment.variantId as ProductVariantId),
    problem: null,
  };
}

export function AdditionalGarments({
  disabled,
  garments,
  onChange,
  onRemoveGarment,
  primaryVariantId,
  requestedInterval,
  calendarAvailabilityByVariant,
  timeZone,
}: {
  disabled: boolean;
  garments: AdditionalGarment[];
  onChange: Update;
  onRemoveGarment: (garmentKey: string) => void;
  primaryVariantId: ProductVariantId | "";
  requestedInterval: InstantInterval | null;
  calendarAvailabilityByVariant: Record<string, StaffReservationAvailabilityCalendarResponse>;
  timeZone: string;
}) {
  const { getToken } = useAuth();
  const intervalKey = requestedInterval
    ? `${requestedInterval.start}|${requestedInterval.end}`
    : null;
  // Each size load and date check runs once; results are matched to current item state before apply.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const pending = garments.filter(
      (garment) =>
        garment.detail === null &&
        garment.error === null &&
        !inFlight.current.has(`detail:${garment.key}`)
    );
    for (const garment of pending) {
      const flightKey = `detail:${garment.key}`;
      inFlight.current.add(flightKey);
      void createDrezivoApiClient(getToken)
        .getCatalogueClothingDetail(garment.productId)
        .then((result) => {
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key ? { ...item, detail: result.data } : item
            )
          );
        })
        .catch(() => {
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key
                ? { ...item, error: `Could not load ${garment.name}.` }
                : item
            )
          );
        })
        .finally(() => inFlight.current.delete(flightKey));
    }
  }, [garments, getToken, onChange]);

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
                ? {
                    ...item,
                    availableAssets: result.data.available_assets,
                    availabilityCheck: result.data,
                    checkedFor,
                    error: null,
                  }
                : item
            )
          );
        })
        .catch(() => {
          onChange((current) =>
            current.map((item) =>
              item.key === garment.key && item.variantId === variantId
                ? {
                    ...item,
                    availabilityCheck: null,
                    checkedFor: intervalKey,
                    error: `Could not check ${garment.name} for these dates.`,
                  }
                : item
            )
          );
        })
        .finally(() => inFlight.current.delete(flightKey));
    }
  }, [garments, getToken, intervalKey, onChange, requestedInterval]);

  const full = garments.length + (primaryVariantId ? 1 : 0) >= MAX_GARMENTS_PER_BOOKING;
  if (garments.length === 0) return null;

  return (
    <div className="space-y-2">
      {garments.map((garment) => {
        const sizes =
          garment.detail?.variants.filter((variant) => variant.status === "active") ?? [];
        return (
          <SelectedGarmentCard
            key={garment.key}
            garment={garment}
            disabled={disabled}
            onRemove={() => onRemoveGarment(garment.key)}
            status={
              <GarmentStatus
                garment={garment}
                intervalKey={intervalKey}
                calendar={calendarAvailabilityByVariant[garment.variantId]}
                timeZone={timeZone}
              />
            }
          >
            {garment.detail && garment.detail.sizing_mode !== "free_size" ? (
              <div
                className="mt-3 flex flex-wrap gap-2"
                role="group"
                aria-label={`${garment.name} size`}
              >
                {sizes.map((variant) => {
                  const alreadySelected =
                    variant.id === primaryVariantId ||
                    garments.some(
                      (item) => item.key !== garment.key && item.variantId === variant.id
                    );
                  return (
                    <Button
                      key={variant.id}
                      type="button"
                      size="sm"
                      disabled={disabled || (alreadySelected && garment.variantId !== variant.id)}
                      variant={garment.variantId === variant.id ? "default" : "secondary"}
                      onClick={() =>
                        onChange((current) =>
                          current.map((item) =>
                            item.key === garment.key
                              ? {
                                  ...item,
                                  variantId: variant.id,
                                  availableAssets: null,
                                  availabilityCheck: null,
                                  checkedFor: null,
                                  error: null,
                                }
                              : item
                          )
                        )
                      }
                    >
                      {displaySizeLabel(variant.size_label)}
                      {variant.color_label ? ` · ${variant.color_label}` : ""}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            {garment.detail && garment.detail.sizing_mode !== "free_size" && !full ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2"
                disabled={disabled}
                onClick={() =>
                  onChange((current) => [
                    ...current,
                    {
                      ...garment,
                      key: `${garment.productId}-${Date.now()}-${current.length}`,
                      variantId: "",
                      availableAssets: null,
                      availabilityCheck: null,
                      checkedFor: null,
                      error: null,
                    },
                  ])
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Add another size of {garment.name}
              </Button>
            ) : null}
          </SelectedGarmentCard>
        );
      })}
      {full ? (
        <p className="text-xs text-dashboard-muted">
          Up to {MAX_GARMENTS_PER_BOOKING} garments per reservation.
        </p>
      ) : null}
    </div>
  );
}

function selectedVariantLabel(garment: AdditionalGarment): string {
  const variant = garment.detail?.variants.find((item) => item.id === garment.variantId);
  if (!variant) return "Choose a size";
  return `${displaySizeLabel(variant.size_label)}${variant.color_label ? ` · ${variant.color_label}` : ""}`;
}

function variantPrice(garment: AdditionalGarment): string {
  const variant = garment.detail?.variants.find((item) => item.id === garment.variantId);
  if (!variant) return "";
  const format = (minor: string) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: variant.currency,
      maximumFractionDigits: 0,
    }).format(Number(minor) / 100);
  return ` · Rental ${format(variant.rental_price_minor)} · Deposit ${format(variant.security_deposit_minor)}`;
}

function GarmentStatus({
  garment,
  intervalKey,
  calendar,
  timeZone,
}: {
  garment: AdditionalGarment;
  intervalKey: string | null;
  calendar: StaffReservationAvailabilityCalendarResponse | undefined;
  timeZone: string;
}) {
  if (garment.error) return <p className="mt-2 text-xs text-dashboard-danger">{garment.error}</p>;
  if (!garment.detail) return <p className="mt-2 text-xs text-dashboard-muted">Loading sizes…</p>;
  if (!garment.variantId)
    return <p className="mt-2 text-xs text-dashboard-muted">Choose a size.</p>;
  const itemLabel = `${garment.name} · ${selectedVariantLabel(garment)}`;
  if (!intervalKey)
    return (
      <p className="mt-2 text-xs text-dashboard-muted">
        Choose the rental dates to check {itemLabel}.
      </p>
    );
  if (garment.checkedFor !== intervalKey || garment.availableAssets === null) {
    return <p className="mt-2 text-xs text-dashboard-muted">Checking {itemLabel} for these dates…</p>;
  }
  return (
    <p
      className={cn(
        "mt-2 text-xs",
        garment.availableAssets > 0 ? "text-dashboard-green-text" : "text-dashboard-danger"
      )}
    >
      {garment.availableAssets > 0
        ? `${itemLabel}: ${garment.availableAssets} free ${garment.availableAssets === 1 ? "piece" : "pieces"} for these dates`
        : recoveryAvailabilityHint(itemLabel, garment.availabilityCheck, calendar, timeZone) ??
          `${itemLabel} is not available for these dates.`}
    </p>
  );
}
