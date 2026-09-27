"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  changeClothingSizingModeRequest,
  type ChangeClothingSizingModeResponse,
  type ChangeClothingSizingModeRequest,
  type ClothingVariantDetail,
  type MeasurementGuide,
} from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

type SizingMode = "sized" | "free_size";
type MeasurementMode = "default_guide" | "custom" | "none";
type MeasurementUnit = "cm" | "in";
type PricingMode = "fixed_duration" | "daily";

type TransitionDraft = {
  id: string;
  sizeLabel: string;
  color: string;
  measurementMode: MeasurementMode;
  measurementGuideId: string | null;
  measurementUnit: MeasurementUnit;
  measurements: Record<string, string>;
  pricingMode: PricingMode;
  rentalPrice: string;
  securityDeposit: string;
  includedDays: string;
  extraDayPrice: string;
  recoveryHours: string;
};

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export function SizingTransitionDialog({
  activeVariants,
  currentMode,
  defaultGuide,
  disabled,
  getToken,
  onCompleted,
  onOpenChange,
  open,
  productId,
}: {
  activeVariants: ClothingVariantDetail[];
  currentMode: SizingMode;
  defaultGuide: MeasurementGuide | null;
  disabled: boolean;
  getToken: () => Promise<string | null>;
  onCompleted: (data: ChangeClothingSizingModeResponse) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  productId: string;
}) {
  const targetMode: SizingMode = currentMode === "sized" ? "free_size" : "sized";
  const { isSubmitting, resetIntent, submit: runSubmit } = useSubmitGuard();
  const [rows, setRows] = useState<TransitionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sourceVariant = activeVariants[0] ?? null;
  const sourceSignature = useMemo(
    () => activeVariants.map((variant) => `${variant.id}:${variant.updated_at}`).join(","),
    [activeVariants]
  );

  useEffect(() => {
    if (!open) return;
    setRows([createTransitionDraft(sourceVariant, targetMode, 0)]);
    setError(null);
    resetIntent();
  }, [open, sourceSignature, targetMode, sourceVariant, resetIntent]);

  const updateRow = (id: string, patch: Partial<TransitionDraft>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
    resetIntent();
  };

  const addSizedRow = () => {
    const used = new Set(rows.map((row) => row.sizeLabel.trim().toLocaleLowerCase()));
    const nextSize = SIZE_OPTIONS.find((size) => !used.has(size.toLocaleLowerCase())) ?? "";
    const source = rows[0] ?? createTransitionDraft(sourceVariant, "sized", 0);
    setRows((current) => [
      ...current,
      { ...source, id: `transition-${current.length + 1}`, sizeLabel: nextSize },
    ]);
    setError(null);
    resetIntent();
  };

  const removeSizedRow = (id: string) => {
    if (rows.length <= 1) return;
    setRows((current) => current.filter((row) => row.id !== id));
    setError(null);
    resetIntent();
  };

  const submit = async () => {
    if (disabled || isSubmitting) return;
    setError(null);
    try {
      const request = buildSizingModeRequest(targetMode, rows, defaultGuide);
      const result = await runSubmit((idempotencyKey) =>
        createDrezivoApiClient(getToken).changeClothingSizingMode(productId, request, idempotencyKey)
      );
      if (!result) return;
      onOpenChange(false);
      await onCompleted(result.data);
    } catch (caughtError) {
      if (caughtError instanceof DrezivoApiError) {
        setError(caughtError.message);
      } else if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError("Could not change the clothing sizing mode.");
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen: boolean) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                Change to {targetMode === "free_size" ? "Free size" : "Sized"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 max-w-2xl text-sm leading-6 text-dashboard-muted">
                Drezivo archives the current active variants instead of deleting them, so reservations, fittings, allocations, and physical-piece history remain intact.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close sizing mode dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dashboard-muted hover:bg-dashboard-active">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 rounded-lg border border-dashboard-border bg-dashboard-active/30 px-3 py-3 text-xs text-dashboard-muted">
            {targetMode === "free_size"
              ? "Free size uses exactly one null-size variant. If this product already has a preserved Free size variant, Drezivo restores it with its saved configuration; otherwise the values below create the new variant."
              : "Sized mode uses one or more unique labelled variants. Each row creates one active rentable piece and may consume physical-asset capacity."}
          </div>

          <div className="mt-5 space-y-4">
            {rows.map((row, index) => (
              <TransitionVariantEditor
                key={row.id}
                defaultGuide={defaultGuide}
                disabled={isSubmitting}
                index={index}
                isFreeSize={targetMode === "free_size"}
                onChange={(patch) => updateRow(row.id, patch)}
                onRemove={() => removeSizedRow(row.id)}
                removable={targetMode === "sized" && rows.length > 1}
                row={row}
              />
            ))}
          </div>

          {targetMode === "sized" ? (
            <Button type="button" variant="secondary" disabled={isSubmitting} onClick={addSizedRow} className="mt-4">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add size
            </Button>
          ) : null}

          {error ? <div role="alert" className="mt-4 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">{error}</div> : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isSubmitting || rows.length === 0} onClick={() => void submit()}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? "Changing…" : "Change sizing mode"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TransitionVariantEditor({
  defaultGuide,
  disabled,
  index,
  isFreeSize,
  onChange,
  onRemove,
  removable,
  row,
}: {
  defaultGuide: MeasurementGuide | null;
  disabled: boolean;
  index: number;
  isFreeSize: boolean;
  onChange: (patch: Partial<TransitionDraft>) => void;
  onRemove: () => void;
  removable: boolean;
  row: TransitionDraft;
}) {
  const measurementKeys = Object.keys(row.measurements).length > 0 ? Object.keys(row.measurements) : ["bust", "waist", "hips"];
  const guideLabel = row.measurementGuideId && row.measurementGuideId === defaultGuide?.id
    ? defaultGuide.name
    : row.measurementGuideId
      ? "Existing reusable guide"
      : defaultGuide?.name ?? "No default guide";

  return (
    <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dashboard-border bg-dashboard-active/35 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-dashboard-navy">Variant {index + 1}{isFreeSize ? " · Free size" : ""}</p>
          <p className="mt-0.5 text-xs text-dashboard-muted">Configure the future active variant.</p>
        </div>
        {removable ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove} aria-label={`Remove transition variant ${index + 1}`} className="border border-dashboard-danger/40 text-dashboard-danger hover:bg-dashboard-danger/10 hover:text-dashboard-danger">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {isFreeSize ? (
            <div className="rounded-lg border border-dashboard-border bg-dashboard-active/25 px-3 py-2.5 text-sm text-dashboard-muted">Size label: <span className="font-semibold text-dashboard-navy">Free size</span></div>
          ) : (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-dashboard-navy">Size label <span className="text-dashboard-danger">*</span></span>
              <Input aria-label={`Sizing transition size ${index + 1}`} value={row.sizeLabel} disabled={disabled} onChange={(event) => onChange({ sizeLabel: event.target.value })} placeholder="e.g. M" />
            </label>
          )}
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-dashboard-navy">Color (optional)</span>
            <Input aria-label={`Sizing transition color ${index + 1}`} value={row.color} disabled={disabled} onChange={(event) => onChange({ color: event.target.value })} placeholder="No color" />
          </label>
        </div>

        <div className="rounded-lg border border-dashboard-border bg-dashboard-active/25 p-4">
          <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-dashboard-navy">Measurement source</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" disabled={disabled} className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                    {measurementModeLabel(row.measurementMode)}
                    <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem disabled={!row.measurementGuideId && !defaultGuide} onSelect={() => onChange({ measurementMode: "default_guide", measurementGuideId: row.measurementGuideId ?? defaultGuide?.id ?? null, measurements: {} })}>Reusable guide</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onChange({ measurementMode: "custom", measurementGuideId: null, measurements: Object.keys(row.measurements).length > 0 ? row.measurements : { bust: "", waist: "", hips: "" } })}>Custom measurements</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onChange({ measurementMode: "none", measurementGuideId: null, measurements: {} })}>No measurements</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </label>

            {row.measurementMode === "default_guide" ? (
              <div className="rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-3 text-xs text-dashboard-muted"><p className="font-medium text-dashboard-navy">{guideLabel}</p><p className="mt-1">The selected reusable guide stays attached to this variant.</p></div>
            ) : row.measurementMode === "custom" ? (
              <div>
                <div className="mb-2 flex justify-end"><div className="flex overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface">{(["cm", "in"] as const).map((unit) => <button key={unit} type="button" disabled={disabled} aria-pressed={row.measurementUnit === unit} onClick={() => onChange({ measurementUnit: unit })} className={cn("min-h-8 px-3 text-[0.68rem] font-medium uppercase", row.measurementUnit === unit ? "bg-dashboard-active text-dashboard-accent" : "text-dashboard-muted hover:bg-dashboard-active")}>{unit}</button>)}</div></div>
                <div className="grid gap-2 sm:grid-cols-3">{measurementKeys.map((key) => <div key={key} className="relative"><Input aria-label={`Sizing transition ${index + 1} ${key}`} inputMode="decimal" value={row.measurements[key] ?? ""} disabled={disabled} onChange={(event) => onChange({ measurements: { ...row.measurements, [key]: event.target.value } })} placeholder={labelize(key)} className="pr-10" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase text-dashboard-muted">{row.measurementUnit}</span></div>)}</div>
              </div>
            ) : <p className="self-center text-xs text-dashboard-muted">No measurement data will be stored for this variant.</p>}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-dashboard-navy">Pricing model</label>
          <div className="grid gap-2 sm:grid-cols-2">
            <PricingChoice selected={row.pricingMode === "fixed_duration"} title="Fixed package" disabled={disabled} onClick={() => onChange({ pricingMode: "fixed_duration" })} />
            <PricingChoice selected={row.pricingMode === "daily"} title="Per day" disabled={disabled} onClick={() => onChange({ pricingMode: "daily" })} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField label={row.pricingMode === "daily" ? "Daily rate" : "Package price"} value={row.rentalPrice} disabled={disabled} required onChange={(value) => onChange({ rentalPrice: value })} />
          <MoneyField label="Security deposit" value={row.securityDeposit} disabled={disabled} onChange={(value) => onChange({ securityDeposit: value })} />
          {row.pricingMode === "fixed_duration" ? <label className="block"><span className="mb-2 block text-sm font-medium text-dashboard-navy">Included duration <span className="text-dashboard-danger">*</span></span><div className="relative"><Input aria-label={`Sizing transition ${index + 1} Included Duration`} inputMode="numeric" value={row.includedDays} disabled={disabled} onChange={(event) => onChange({ includedDays: event.target.value })} className="pr-14" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span></div></label> : null}
          <MoneyField label="Extra day price" value={row.extraDayPrice} disabled={disabled || row.pricingMode === "daily"} onChange={(value) => onChange({ extraDayPrice: value })} />
          <label className="block"><span className="mb-2 block text-sm font-medium text-dashboard-navy">Recovery after return</span><div className="relative"><Input aria-label={`Sizing transition ${index + 1} Recovery Time`} inputMode="decimal" value={row.recoveryHours} disabled={disabled} onChange={(event) => onChange({ recoveryHours: event.target.value })} className="pr-14" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">hours</span></div></label>
        </div>
      </div>
    </div>
  );
}

function createTransitionDraft(variant: ClothingVariantDetail | null, targetMode: SizingMode, index: number): TransitionDraft {
  return {
    id: `transition-${index + 1}`,
    sizeLabel: targetMode === "free_size" ? "" : SIZE_OPTIONS[index + 1] ?? SIZE_OPTIONS[0],
    color: variant?.color_label ?? "",
    measurementMode: variant?.measurement_mode ?? "none",
    measurementGuideId: variant?.measurement_guide_id ?? null,
    measurementUnit: variant?.measurement_unit ?? "cm",
    measurements: Object.fromEntries(Object.entries(variant?.measurements ?? {}).map(([key, value]) => [key, String(value)])),
    pricingMode: variant?.pricing_mode ?? "fixed_duration",
    rentalPrice: variant ? minorToPesos(variant.rental_price_minor) : "",
    securityDeposit: variant ? minorToPesos(variant.security_deposit_minor) : "0",
    includedDays: variant ? String(variant.included_duration_minutes / (24 * 60)) : "3",
    extraDayPrice: variant ? minorToPesos(variant.extra_day_price_minor) : "",
    recoveryHours: variant ? formatDecimal(variant.turnaround_minutes / 60) : "24",
  };
}

function buildSizingModeRequest(
  mode: SizingMode,
  rows: TransitionDraft[],
  defaultGuide: MeasurementGuide | null
): ChangeClothingSizingModeRequest {
  if (mode === "free_size" && rows.length !== 1) throw new Error("Free size requires exactly one variant.");
  const seen = new Set<string>();
  const variants = rows.map((row, index) => {
    const sizeLabel = mode === "free_size" ? null : row.sizeLabel.trim();
    if (mode === "sized" && !sizeLabel) throw new Error(`Enter a size label for variant ${index + 1}.`);
    if (sizeLabel !== null) {
      const key = sizeLabel.toLocaleLowerCase();
      if (seen.has(key)) throw new Error("Each sized variant must use a unique size label.");
      seen.add(key);
    }

    const measurement = buildTransitionMeasurement(row, defaultGuide, index);
    return {
      size_label: sizeLabel,
      color_label: row.color.trim() || null,
      measurement_mode: measurement.measurement_mode,
      measurement_guide_id: measurement.measurement_guide_id,
      measurement_unit: measurement.measurement_unit,
      measurements: measurement.measurements,
      pricing: buildTransitionPricing(row, index),
    };
  });

  return changeClothingSizingModeRequest.parse(mode === "free_size" ? { mode, variant: variants[0] } : { mode, variants });
}

function buildTransitionMeasurement(row: TransitionDraft, defaultGuide: MeasurementGuide | null, index: number) {
  if (row.measurementMode === "default_guide") {
    const guideId = row.measurementGuideId ?? defaultGuide?.id ?? null;
    if (!guideId) throw new Error(`Choose a reusable measurement guide for variant ${index + 1}.`);
    return { measurement_mode: "default_guide" as const, measurement_guide_id: guideId, measurement_unit: row.measurementUnit, measurements: {} };
  }
  if (row.measurementMode === "none") {
    return { measurement_mode: "none" as const, measurement_guide_id: null, measurement_unit: row.measurementUnit, measurements: {} };
  }
  const measurements = Object.fromEntries(Object.entries(row.measurements).filter(([, value]) => value.trim() !== "").map(([key, value]) => [key, parseMeasurement(value, `${key} for variant ${index + 1}`)]));
  if (Object.keys(measurements).length === 0) throw new Error(`Enter at least one custom measurement for variant ${index + 1}.`);
  return { measurement_mode: "custom" as const, measurement_guide_id: null, measurement_unit: row.measurementUnit, measurements };
}

function buildTransitionPricing(row: TransitionDraft, index: number) {
  const rental = pesosToMinor(row.rentalPrice, `Variant ${index + 1} rental price`);
  const security = pesosToMinor(row.securityDeposit || "0", `Variant ${index + 1} security deposit`);
  const extra = pesosToMinor(row.extraDayPrice || row.rentalPrice, `Variant ${index + 1} extra day price`);
  const common = { rental_price_minor: rental, security_deposit_minor: security, extra_day_price_minor: extra, prep_minutes: 0 as const, turnaround_minutes: hoursToMinutes(row.recoveryHours || "0", `Variant ${index + 1} recovery after return`) };
  if (row.pricingMode === "daily") return { mode: "daily" as const, ...common };
  const includedDays = Number(row.includedDays);
  if (!Number.isInteger(includedDays) || includedDays < 1 || includedDays > 30) throw new Error(`Variant ${index + 1} included duration must be a whole number from 1 to 30 days.`);
  return { mode: "fixed_duration" as const, included_days: includedDays, ...common };
}

function PricingChoice({ disabled, onClick, selected, title }: { disabled: boolean; onClick: () => void; selected: boolean; title: string }) {
  return <button type="button" disabled={disabled} aria-pressed={selected} onClick={onClick} className={cn("flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors disabled:opacity-60", selected ? "border-dashboard-accent bg-dashboard-active text-dashboard-navy" : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active")}><span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", selected ? "border-dashboard-accent" : "border-dashboard-border")}>{selected ? <Check className="h-3 w-3 text-dashboard-accent" aria-hidden="true" /> : null}</span>{title}</button>;
}

function MoneyField({ disabled = false, label, onChange, required = false, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; required?: boolean; value: string }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-dashboard-navy">{label} {required ? <span className="text-dashboard-danger">*</span> : null}</span><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-dashboard-muted">₱</span><Input aria-label={label} inputMode="decimal" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="pl-7" /></div></label>;
}

function measurementModeLabel(mode: MeasurementMode): string {
  if (mode === "default_guide") return "Reusable guide";
  if (mode === "custom") return "Custom measurements";
  return "No measurements";
}

function labelize(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function pesosToMinor(value: string, label: string): string {
  const parsed = Number(value.replaceAll(",", "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a valid non-negative amount.`);
  const minor = Math.round(parsed * 100);
  if (!Number.isSafeInteger(minor)) throw new Error(`${label} is too large.`);
  return String(minor);
}

function hoursToMinutes(value: string, label: string): number {
  const parsed = Number(value.trim());
  const minutes = Math.round(parsed * 60);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(minutes)) throw new Error(`${label} must be a valid non-negative number of hours.`);
  return minutes;
}

function parseMeasurement(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function minorToPesos(value: string): string {
  return formatDecimal(Number(value) / 100);
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
