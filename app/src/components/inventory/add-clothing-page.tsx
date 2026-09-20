"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Eye,
  ImagePlus,
  Images,
  Info,
  PackagePlus,
  PhilippinePeso,
  Plus,
  Ruler,
  Save,
  Settings2,
  Shirt,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useMeasurementGuide } from "@/components/settings/measurement-guide-context";
import { cn } from "@/lib/utils";

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
type ClothingSize = (typeof SIZE_OPTIONS)[number];
type PricingMode = "fixed_duration" | "daily";
type MeasurementUnit = "in" | "cm";
type MeasurementMode = "default_guide" | "custom" | "none";

type Measurements = {
  bust: string;
  waist: string;
  hips: string;
};

const EMPTY_MEASUREMENTS: Measurements = { bust: "", waist: "", hips: "" };

const CATEGORIES = [
  "Evening Gown",
  "Wedding Gown",
  "Bridesmaid Dress",
  "Debut Gown",
  "Filipiniana",
  "Barong",
  "Formal Wear",
  "Costume",
] as const;

export function AddClothingPage() {
  const { guide } = useMeasurementGuide();
  const [category, setCategory] = useState<string>("Evening Gown");
  const [selectedSizes, setSelectedSizes] = useState<ClothingSize[]>(["S", "M", "L", "XL"]);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("in");
  const [measurementModes, setMeasurementModes] = useState<Record<ClothingSize, MeasurementMode>>(() =>
    Object.fromEntries(SIZE_OPTIONS.map((size) => [size, "default_guide"])) as Record<
      ClothingSize,
      MeasurementMode
    >
  );
  const [measurements, setMeasurements] = useState<Record<ClothingSize, Measurements>>(() =>
    Object.fromEntries(SIZE_OPTIONS.map((size) => [size, { ...EMPTY_MEASUREMENTS }])) as Record<
      ClothingSize,
      Measurements
    >
  );
  const [pricingMode, setPricingMode] = useState<PricingMode>("fixed_duration");
  const [price, setPrice] = useState("300");
  const [includedDays, setIncludedDays] = useState("3");
  const [extraDayPrice, setExtraDayPrice] = useState("100");
  const [securityDeposit, setSecurityDeposit] = useState("500");
  const [prepHours, setPrepHours] = useState("0");
  const [turnaroundHours, setTurnaroundHours] = useState("24");
  const [timingOpen, setTimingOpen] = useState(false);
  const [measurementGuideOpen, setMeasurementGuideOpen] = useState(false);

  const totalPieces = selectedSizes.length;
  const pricingSummary = useMemo(() => {
    const formattedPrice = price.trim() ? `₱${Number(price || 0).toLocaleString()}` : "Set price";
    if (pricingMode === "daily") return `${formattedPrice} / day`;
    const days = includedDays.trim() || "0";
    const extra = extraDayPrice.trim()
      ? ` · ₱${Number(extraDayPrice || 0).toLocaleString()}/additional day`
      : "";
    return `${formattedPrice} for ${days} day${days === "1" ? "" : "s"}${extra}`;
  }, [extraDayPrice, includedDays, price, pricingMode]);

  const toggleSize = (size: ClothingSize) => {
    setSelectedSizes((current) =>
      current.includes(size) ? current.filter((item) => item !== size) : [...current, size]
    );
  };

  const setMeasurementMode = (size: ClothingSize, mode: MeasurementMode) => {
    setMeasurementModes((current) => ({ ...current, [size]: mode }));
    if (mode !== "custom") {
      setMeasurements((current) => ({ ...current, [size]: { ...EMPTY_MEASUREMENTS } }));
    }
  };

  const useDefaultGuideForAll = () => {
    setMeasurementModes((current) => {
      const next = { ...current };
      selectedSizes.forEach((size) => {
        next[size] = "default_guide";
      });
      return next;
    });
    setMeasurements((current) => {
      const next = { ...current };
      selectedSizes.forEach((size) => {
        next[size] = { ...EMPTY_MEASUREMENTS };
      });
      return next;
    });
  };

  const updateMeasurement = (
    size: ClothingSize,
    field: keyof Measurements,
    value: string
  ) => {
    setMeasurements((current) => ({
      ...current,
      [size]: { ...current[size], [field]: value },
    }));
  };

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-screen-2xl">
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
          <Link
            href="/inventory"
            className="inline-flex items-center gap-2 text-dashboard-muted transition-colors hover:text-dashboard-navy"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Clothing
          </Link>
          <span className="text-dashboard-muted">/</span>
          <span className="font-medium text-dashboard-navy">Add Clothing</span>
        </div>

        <div className="mb-5">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
            Add Clothing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-dashboard-muted">
            Add one clothing style, choose the sizes you own, and Drezivo will create one rentable piece for each selected size.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="space-y-4">
            <SectionCard
              icon={Images}
              title="Photos"
              description="Upload photos once. They will be shared across all sizes of this clothing style."
            >
              <div className="flex flex-wrap gap-3">
                <div className="relative flex h-36 w-28 items-center justify-center rounded-xl border border-dashboard-border bg-dashboard-active">
                  <Shirt className="h-9 w-9 text-dashboard-accent" aria-hidden="true" />
                  <span className="absolute bottom-2 left-2 rounded bg-dashboard-surface/90 px-2 py-1 text-[0.65rem] font-medium text-dashboard-navy">
                    Main photo
                  </span>
                </div>
                <button
                  type="button"
                  className="flex h-36 w-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-dashboard-border bg-dashboard-surface text-xs font-medium text-dashboard-muted transition-colors hover:border-dashboard-accent hover:bg-dashboard-active hover:text-dashboard-accent"
                >
                  <ImagePlus className="h-5 w-5" aria-hidden="true" />
                  Add Photos
                  <span className="text-[0.65rem] font-normal">Up to 10</span>
                </button>
              </div>
            </SectionCard>

            <SectionCard
              icon={Shirt}
              title="Clothing Information"
              description="These details describe the clothing style customers will see."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Clothing Name" required>
                  <Input defaultValue="Emerald Evening Gown" placeholder="e.g. Emerald Evening Gown" />
                </Field>
                <Field label="Category" required>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
                      >
                        {category}
                        <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-52">
                      {CATEGORIES.map((item) => (
                        <DropdownMenuItem key={item} onSelect={() => setCategory(item)}>
                          {item}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  defaultValue="Elegant emerald green evening gown with a flattering silhouette and slit detail."
                  placeholder="Describe this clothing style..."
                  rows={4}
                  className="w-full resize-y rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm text-dashboard-navy outline-none transition placeholder:text-dashboard-muted focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20"
                />
              </Field>
            </SectionCard>

            <SectionCard
              icon={Ruler}
              title="Color, Sizes & Measurements"
              description="Choose the sizes you actually own. Each selected size creates one rentable piece in V1."
            >
              <Field label="Color" required>
                <Input defaultValue="Emerald Green" placeholder="e.g. Emerald Green" className="max-w-md" />
              </Field>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium text-dashboard-navy">
                    Available Sizes <span className="text-dashboard-danger">*</span>
                  </label>
                  <span className="text-xs text-dashboard-muted">
                    {totalPieces} selected · {totalPieces} Total {totalPieces === 1 ? "Piece" : "Pieces"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SIZE_OPTIONS.map((size) => {
                    const selected = selectedSizes.includes(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSize(size)}
                        className={cn(
                          "min-h-10 min-w-12 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                          selected
                            ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                            : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
                        )}
                      >
                        {selected ? <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {size}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashboard-border bg-dashboard-active/50 px-3 py-2.5 text-xs text-dashboard-muted">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
                  <span>
                    For V1, every selected size maps to one physical piece. You can expand this later if a business owns multiple copies of the same size.
                  </span>
                </div>
              </div>

              {selectedSizes.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-dashboard-border">
                  <div className="flex flex-col gap-3 border-b border-dashboard-border bg-dashboard-active/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-dashboard-navy">Measurements</p>
                      <p className="mt-0.5 text-xs text-dashboard-muted">
                        Use the shop&apos;s guide by default. Only enter custom measurements for exceptions.
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={useDefaultGuideForAll} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:text-dashboard-navy">
                      Use default for all
                    </Button>
                  </div>

                  <div className="border-b border-dashboard-border p-4">
                    <div className="flex flex-col gap-3 rounded-xl border border-dashboard-border bg-dashboard-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl dashboard-tone-blue">
                          <Ruler className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-dashboard-navy">{guide.name}</p>
                          <p className="mt-1 text-xs text-dashboard-muted">
                            Shared guide · one image reused across clothing styles
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setMeasurementGuideOpen(true)} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:text-dashboard-navy">
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          View Measurement
                        </Button>
                        <Link
                          href="/settings/measurement-guide"
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                        >
                          <Settings2 className="h-4 w-4" aria-hidden="true" />
                          Change Default
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-dashboard-border">
                    {SIZE_OPTIONS.filter((size) => selectedSizes.includes(size)).map((size) => {
                      const mode = measurementModes[size];
                      const modeLabel = mode === "default_guide" ? "Default guide" : mode === "custom" ? "Custom" : "None";
                      return (
                        <div key={size} className="grid gap-3 px-4 py-4 lg:grid-cols-[4rem_11rem_minmax(0,1fr)] lg:items-center">
                          <span className="text-sm font-semibold text-dashboard-navy">{size}</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                                {modeLabel}
                                <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48">
                              <DropdownMenuItem onSelect={() => setMeasurementMode(size, "default_guide")}>Default guide</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setMeasurementMode(size, "custom")}>Custom measurements</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setMeasurementMode(size, "none")}>No measurements</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          {mode === "custom" ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-dashboard-muted">Custom measurements for size {size}</span>
                                <div className="flex overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface">
                                  {(["in", "cm"] as const).map((unit) => (
                                    <button
                                      key={unit}
                                      type="button"
                                      aria-pressed={measurementUnit === unit}
                                      onClick={() => setMeasurementUnit(unit)}
                                      className={cn(
                                        "min-h-7 px-2.5 text-[0.68rem] font-medium uppercase",
                                        measurementUnit === unit
                                          ? "bg-dashboard-active text-dashboard-accent"
                                          : "text-dashboard-muted hover:bg-dashboard-active"
                                      )}
                                    >
                                      {unit}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-3">
                                {(["bust", "waist", "hips"] as const).map((field) => (
                                  <div key={field} className="relative">
                                    <Input
                                      aria-label={`${size} ${field}`}
                                      inputMode="decimal"
                                      value={measurements[size][field]}
                                      onChange={(event) => updateMeasurement(size, field, event.target.value)}
                                      placeholder={field[0]!.toUpperCase() + field.slice(1)}
                                      className="pr-9"
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase text-dashboard-muted">
                                      {measurementUnit}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : mode === "default_guide" ? (
                            <p className="text-xs text-dashboard-muted">
                              Uses {guide.name}. Variant measurements remain empty.
                            </p>
                          ) : (
                            <p className="text-xs text-dashboard-muted">No measurement information will be shown for this size.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              icon={PhilippinePeso}
              title="Pricing"
              description="Enter pricing once. Drezivo applies it to every selected size when the variants are created."
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-dashboard-navy">
                  Pricing Model <span className="text-dashboard-danger">*</span>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <PricingModeButton
                    selected={pricingMode === "fixed_duration"}
                    title="Fixed Package"
                    description="Example: ₱300 for 3 days"
                    onClick={() => setPricingMode("fixed_duration")}
                  />
                  <PricingModeButton
                    selected={pricingMode === "daily"}
                    title="Per Day"
                    description="Example: ₱300 per day"
                    onClick={() => setPricingMode("daily")}
                  />
                </div>
              </div>

              {pricingMode === "fixed_duration" ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MoneyField label="Package Price" value={price} onChange={setPrice} required />
                  <Field label="Included Duration" required>
                    <div className="relative">
                      <Input
                        aria-label="Included Duration"
                        inputMode="numeric"
                        value={includedDays}
                        onChange={(event) => setIncludedDays(event.target.value)}
                        className="pr-14"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span>
                    </div>
                  </Field>
                  <MoneyField label="Extra Day Price" value={extraDayPrice} onChange={setExtraDayPrice} />
                  <MoneyField label="Security Deposit" value={securityDeposit} onChange={setSecurityDeposit} />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField label="Daily Rate" value={price} onChange={setPrice} required suffix="/ day" />
                  <MoneyField label="Security Deposit" value={securityDeposit} onChange={setSecurityDeposit} />
                </div>
              )}

              <div className="rounded-lg border border-dashboard-border bg-dashboard-active/50 px-3 py-3">
                <p className="text-xs text-dashboard-muted">Customer-facing price summary</p>
                <p className="mt-1 text-sm font-semibold text-dashboard-navy">{pricingSummary}</p>
              </div>
            </SectionCard>

            <Card className="gap-0 py-0">
              <button
                type="button"
                aria-expanded={timingOpen}
                onClick={() => setTimingOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg dashboard-tone-orange">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-dashboard-navy">Rental Timing</span>
                    <span className="mt-0.5 block text-xs text-dashboard-muted">
                      Preparation {prepHours}h · Turnaround {turnaroundHours}h
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className={cn("h-4 w-4 text-dashboard-muted transition-transform", timingOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
              {timingOpen ? (
                <CardContent className="grid gap-4 border-t border-dashboard-border p-5 sm:grid-cols-2">
                  <Field label="Preparation Buffer">
                    <div className="relative">
                      <Input
                        aria-label="Preparation Buffer"
                        inputMode="numeric"
                        value={prepHours}
                        onChange={(event) => setPrepHours(event.target.value)}
                        className="pr-14"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">hours</span>
                    </div>
                  </Field>
                  <Field label="Turnaround Buffer">
                    <div className="relative">
                      <Input
                        aria-label="Turnaround Buffer"
                        inputMode="numeric"
                        value={turnaroundHours}
                        onChange={(event) => setTurnaroundHours(event.target.value)}
                        className="pr-14"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">hours</span>
                    </div>
                  </Field>
                  <p className="text-xs text-dashboard-muted sm:col-span-2">
                    These buffers help prevent the same physical piece from being booked too close to another rental period.
                  </p>
                </CardContent>
              ) : null}
            </Card>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl dashboard-tone-blue">
                    <PackagePlus className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-dashboard-navy">What Drezivo will create</h2>
                    <p className="mt-0.5 text-xs text-dashboard-muted">Based on the sizes selected above.</p>
                  </div>
                </div>

                <div className="mt-5 divide-y divide-dashboard-border rounded-xl border border-dashboard-border">
                  <SummaryRow label="Clothing Style" value="1" />
                  <SummaryRow label="Variants" value={String(totalPieces)} />
                  <SummaryRow label="Total Pieces" value={String(totalPieces)} emphasize />
                </div>

                {selectedSizes.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-dashboard-muted">Generated size mapping</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedSizes.map((size) => (
                        <span
                          key={size}
                          className="rounded-lg border border-dashboard-border bg-dashboard-active px-2.5 py-1.5 text-xs font-semibold text-dashboard-accent"
                        >
                          {size} → 1 piece
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-dashboard-border px-3 py-4 text-center text-xs text-dashboard-muted">
                    Select at least one size to create a rentable piece.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardContent className="space-y-3 p-5">
                <Button variant="ghost" className="w-full border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save as Draft
                </Button>
                <Button className="w-full" disabled={selectedSizes.length === 0}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Clothing
                </Button>
                <p className="text-center text-[0.68rem] leading-5 text-dashboard-muted">
                  Add Clothing creates the selected variants and one physical piece for each size.
                </p>
              </CardContent>
            </Card>

            <div className="rounded-xl border border-dashboard-border bg-dashboard-surface p-4 text-xs text-dashboard-muted">
              <div className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
                <p>
                  Availability is managed separately in the Clothing Availability calendar. New clothing does not need an availability calendar during creation.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <MeasurementGuideSheet
        guide={guide}
        open={measurementGuideOpen}
        onOpenChange={setMeasurementGuideOpen}
      />
    </div>
  );
}

function MeasurementGuideSheet({
  guide,
  open,
  onOpenChange,
}: {
  guide: { name: string; previewUrl: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = [
    ["S", "32–34", "25–27", "34–36"],
    ["M", "34–36", "27–29", "36–38"],
    ["L", "36–38", "29–31", "38–40"],
    ["XL", "38–40", "31–33", "40–42"],
  ] as const;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-lg"
      >
        <div className="p-5 pr-14">
          <SheetTitle>{guide.name}</SheetTitle>
          <SheetDescription className="mt-1">
            This reusable guide can be referenced by many clothing variants without uploading another image.
          </SheetDescription>
        </div>

        <div className="border-y border-dashboard-border bg-dashboard-canvas p-5">
          <div className="overflow-hidden rounded-2xl border border-dashboard-border bg-dashboard-surface shadow-sm">
            <div className="flex min-h-40 items-center justify-center border-b border-dashboard-border bg-dashboard-active/40 p-6 text-center">
              {guide.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- prototype object URL; production uses the governed file projection.
                <img src={guide.previewUrl} alt={`${guide.name} preview`} className="max-h-80 w-full object-contain" />
              ) : (
                <div>
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl dashboard-tone-blue">
                    <Ruler className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-dashboard-navy">Default measurement image preview</p>
                  <p className="mt-1 text-xs text-dashboard-muted">Standard Size Guide · inches</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 border-b border-dashboard-border px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-wide text-dashboard-muted">
              <span>Size</span>
              <span>Bust</span>
              <span>Waist</span>
              <span>Hips</span>
            </div>
            {rows.map(([size, bust, waist, hips]) => (
              <div key={size} className="grid grid-cols-4 border-b border-dashboard-border px-4 py-3 text-xs last:border-b-0">
                <span className="font-semibold text-dashboard-navy">{size}</span>
                <span className="text-dashboard-muted">{bust}</span>
                <span className="text-dashboard-muted">{waist}</span>
                <span className="text-dashboard-muted">{hips}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-5">
          <div className="rounded-xl border border-dashboard-border bg-dashboard-active/40 p-4 text-xs leading-5 text-dashboard-muted">
            Clothing using this guide keeps a stable reference to this exact guide. Replacing the business default later does not silently change existing clothing.
          </div>
          <Link
            href="/settings/measurement-guide"
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-dashboard-border bg-dashboard-surface px-4 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Manage default measurement guide
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionCard({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
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
        <div className="space-y-5">{children}</div>
      </CardContent>
    </Card>
  );
}

function Field({
  children,
  label,
  required = false,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-dashboard-navy">
        {label} {required ? <span className="text-dashboard-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function MoneyField({
  label,
  onChange,
  required = false,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  suffix?: string;
  value: string;
}) {
  return (
    <Field label={label} required={required}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-dashboard-muted">₱</span>
        <Input
          aria-label={label}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn("pl-8", suffix && "pr-14")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">{suffix}</span>
        ) : null}
      </div>
    </Field>
  );
}

function PricingModeButton({
  description,
  onClick,
  selected,
  title,
}: {
  description: string;
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
        selected
          ? "border-dashboard-accent bg-dashboard-active"
          : "border-dashboard-border bg-dashboard-surface hover:bg-dashboard-active"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-dashboard-navy">
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border",
            selected ? "border-dashboard-accent" : "border-dashboard-border"
          )}
        >
          {selected ? <span className="h-2 w-2 rounded-full bg-dashboard-accent" /> : null}
        </span>
        {title}
      </span>
      <span className="mt-1.5 block pl-6 text-xs text-dashboard-muted">{description}</span>
    </button>
  );
}

function SummaryRow({
  emphasize = false,
  label,
  value,
}: {
  emphasize?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-xs text-dashboard-muted">{label}</span>
      <span className={cn("text-sm font-semibold", emphasize ? "text-dashboard-accent" : "text-dashboard-navy")}>{value}</span>
    </div>
  );
}
