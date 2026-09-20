"use client";

import { useAuth } from "@clerk/nextjs";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Eye,
  AlertCircle,
  ImagePlus,
  Images,
  Info,
  Loader2,
  PackagePlus,
  PhilippinePeso,
  Plus,
  Ruler,
  Save,
  Settings2,
  Shirt,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  createClothingRequest,
  type CatalogueCategory,
  type CreateClothingRequest,
  type MeasurementGuide,
} from "@drezivo/contracts";

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
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
type ClothingSize = (typeof SIZE_OPTIONS)[number];
type PricingMode = "fixed_duration" | "daily";
type MeasurementUnit = "in" | "cm";
type MeasurementMode = "default_guide" | "custom" | "none";
type PhotoStatus = "ready" | "uploading" | "uploaded" | "error";

type GuideSetupIntent = {
  fingerprint: string;
  uploadKey: string;
  finalizeKey: string;
  saveKey: string;
};

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  uploadIntentKey: string;
  finalizeIntentKey: string;
  fileId: string | null;
  status: PhotoStatus;
  error: string | null;
};

type Measurements = {
  bust: string;
  waist: string;
  hips: string;
};

const EMPTY_MEASUREMENTS: Measurements = { bust: "", waist: "", hips: "" };

export function AddClothingPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const guideFileInputRef = useRef<HTMLInputElement>(null);
  const submitIntentRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const guideSetupIntentRef = useRef<GuideSetupIntent | null>(null);
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [categoryLoadError, setCategoryLoadError] = useState(false);
  const [defaultGuide, setDefaultGuide] = useState<MeasurementGuide | null>(null);
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideLoadError, setGuideLoadError] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
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
  const [prepDays, setPrepDays] = useState("0");
  const [recoveryDays, setRecoveryDays] = useState("1");
  const [timingOpen, setTimingOpen] = useState(false);
  const [measurementGuideOpen, setMeasurementGuideOpen] = useState(false);
  const [guideSetupOpen, setGuideSetupOpen] = useState(false);
  const [guideName, setGuideName] = useState("");
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [guidePreviewUrl, setGuidePreviewUrl] = useState<string | null>(null);
  const [guideSetupError, setGuideSetupError] = useState<string | null>(null);
  const [guideSaveStage, setGuideSaveStage] = useState<string | null>(null);
  const [isSavingGuide, setIsSavingGuide] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.status === "active"),
    [categories]
  );
  const selectedCategory =
    activeCategories.find((category) => category.id === categoryId) ?? null;

  const loadCategories = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setCategoryLoading(true);
    setCategoryLoadError(false);
    try {
      const result = await createDrezivoApiClient(getToken).getCatalogueCategories();
      setCategories(result.data.items);
      const active = result.data.items.filter((category) => category.status === "active");
      setCategoryId((current) =>
        current && active.some((category) => category.id === current)
          ? current
          : (active[0]?.id ?? null)
      );
    } catch {
      setCategoryLoadError(true);
      setCategories([]);
      setCategoryId(null);
    } finally {
      setCategoryLoading(false);
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const loadDefaultGuide = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setGuideLoading(true);
    setGuideLoadError(false);
    try {
      const result = await createDrezivoApiClient(getToken).getDefaultMeasurementGuide();
      setDefaultGuide(result.data.guide);
    } catch {
      setGuideLoadError(true);
      setDefaultGuide(null);
    } finally {
      setGuideLoading(false);
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void loadDefaultGuide();
  }, [loadDefaultGuide]);

  useEffect(
    () => () => {
      if (guidePreviewUrl) URL.revokeObjectURL(guidePreviewUrl);
    },
    [guidePreviewUrl]
  );

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

  const openGuideSetup = () => {
    setGuideSetupError(null);
    setGuideSaveStage(null);
    if (!guideName.trim()) setGuideName("Standard Size Guide");
    setGuideSetupOpen(true);
  };

  const selectGuideFile = (file: File | null) => {
    setGuideSetupError(null);
    guideSetupIntentRef.current = null;
    if (!file) {
      setGuideFile(null);
      setGuidePreviewUrl(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setGuideSetupError("Size guide images must be JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setGuideSetupError("The size guide image must be 10 MB or smaller.");
      return;
    }
    setGuideFile(file);
    setGuidePreviewUrl(URL.createObjectURL(file));
    if (guideFileInputRef.current) guideFileInputRef.current.value = "";
  };

  const saveDefaultGuide = async () => {
    if (isSavingGuide) return;
    if (!guideName.trim()) {
      setGuideSetupError("Enter a name for the default size guide.");
      return;
    }
    if (!guideFile) {
      setGuideSetupError("Choose a size guide image before saving.");
      return;
    }

    const fingerprint = `${guideName.trim()}|${guideFile.name}|${guideFile.type}|${guideFile.size}|${guideFile.lastModified}`;
    const intent =
      guideSetupIntentRef.current?.fingerprint === fingerprint
        ? guideSetupIntentRef.current
        : {
            fingerprint,
            uploadKey: newIntentKey("guide_upload"),
            finalizeKey: newIntentKey("guide_finalize"),
            saveKey: newIntentKey("guide_save"),
          };
    guideSetupIntentRef.current = intent;
    setIsSavingGuide(true);
    setGuideSetupError(null);

    try {
      const client = createDrezivoApiClient(getToken);
      setGuideSaveStage("Preparing size guide…");
      const sha256 = await fileSha256Base64(guideFile);
      const authorized = await client.authorizeUpload(
        {
          purpose: "measurement_guide",
          content_type: guideFile.type as "image/jpeg" | "image/png" | "image/webp",
          byte_size: guideFile.size,
          sha256,
        },
        intent.uploadKey
      );

      setGuideSaveStage("Uploading size guide…");
      const uploadResponse = await fetch(authorized.data.upload_url, {
        method: "PUT",
        headers: authorized.data.required_headers,
        body: guideFile,
      });
      if (!uploadResponse.ok) {
        throw new Error("The size guide upload did not finish successfully.");
      }

      setGuideSaveStage("Finalizing size guide…");
      const finalized = await client.finalizeUpload(authorized.data.file_id, intent.finalizeKey);

      setGuideSaveStage("Saving default guide…");
      const saved = await client.saveMeasurementGuide(
        {
          name: guideName.trim(),
          file_id: finalized.data.file.file_id,
          make_default: true,
        },
        intent.saveKey
      );
      let savedGuide = saved.data;
      try {
        const refreshed = await client.getDefaultMeasurementGuide();
        if (refreshed.data.guide) savedGuide = refreshed.data.guide;
      } catch {
        // The guide is already persisted; a later page refresh can obtain a new signed view URL.
      }

      setDefaultGuide(savedGuide);
      setGuideLoadError(false);
      setGuideSetupOpen(false);
      setGuideName("");
      setGuideFile(null);
      setGuidePreviewUrl(null);
      setGuideSaveStage(null);
      guideSetupIntentRef.current = null;
    } catch (error) {
      setGuideSetupError(errorMessage(error, "Could not save the default size guide."));
    } finally {
      setIsSavingGuide(false);
      setGuideSaveStage(null);
    }
  };

  const needsDefaultGuide = selectedSizes.some(
    (size) => measurementModes[size] === "default_guide"
  );

  const selectPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFormError(null);
    const incoming = Array.from(files);
    const availableSlots = Math.max(0, 10 - photos.length);
    if (incoming.length > availableSlots) {
      setFormError(`You can upload a maximum of 10 photos. ${availableSlots} slot${availableSlots === 1 ? " is" : "s are"} available.`);
    }
    const accepted = incoming.slice(0, availableSlots).filter((file) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setFormError("Photos must be JPEG, PNG, or WebP images.");
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        setFormError("Each clothing photo must be 10 MB or smaller.");
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;
    setPhotos((current) => [
      ...current,
      ...accepted.map((file) => ({
        id: newIntentKey("photo"),
        file,
        previewUrl: URL.createObjectURL(file),
        uploadIntentKey: newIntentKey("upload"),
        finalizeIntentKey: newIntentKey("finalize"),
        fileId: null,
        status: "ready" as const,
        error: null,
      })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== photoId);
    });
  };

  const updatePhoto = (photoId: string, patch: Partial<PendingPhoto>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo))
    );
  };

  const uploadPhoto = async (photo: PendingPhoto): Promise<string> => {
    if (photo.fileId) return photo.fileId;
    const client = createDrezivoApiClient(getToken);
    updatePhoto(photo.id, { status: "uploading", error: null });
    try {
      const sha256 = await fileSha256Base64(photo.file);
      const authorized = await client.authorizeUpload(
        {
          purpose: "catalogue_image",
          content_type: photo.file.type as "image/jpeg" | "image/png" | "image/webp",
          byte_size: photo.file.size,
          sha256,
        },
        photo.uploadIntentKey
      );
      const uploadResponse = await fetch(authorized.data.upload_url, {
        method: "PUT",
        headers: authorized.data.required_headers,
        body: photo.file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Photo upload failed before Drezivo could accept the file.");
      }
      const finalized = await client.finalizeUpload(
        authorized.data.file_id,
        photo.finalizeIntentKey
      );
      const fileId = finalized.data.file.file_id;
      updatePhoto(photo.id, { fileId, status: "uploaded", error: null });
      return fileId;
    } catch (error) {
      const message = errorMessage(error, "Could not upload this photo.");
      updatePhoto(photo.id, { status: "error", error: message });
      throw error;
    }
  };

  const buildCreateRequest = (activate: boolean, imageFileIds: string[]): CreateClothingRequest => {
    if (!categoryId) throw new Error("Choose an active category.");
    if (!name.trim()) throw new Error("Enter a clothing name.");
    if (!color.trim()) throw new Error("Enter a clothing color.");
    if (selectedSizes.length === 0) throw new Error("Select at least one size.");
    if (needsDefaultGuide && !defaultGuide) {
      throw new Error("Set a default measurement guide, or use custom/no measurements for every selected size.");
    }

    const sizes = selectedSizes.map((size) => {
      const mode = measurementModes[size];
      if (mode === "default_guide") {
        return {
          size_label: size,
          measurement_mode: mode,
          measurement_guide_id: defaultGuide!.id,
          measurement_unit: measurementUnit,
          measurements: {},
        };
      }
      if (mode === "custom") {
        const values = Object.fromEntries(
          Object.entries(measurements[size])
            .filter(([, value]) => value.trim() !== "")
            .map(([field, value]) => [field, parseMeasurement(value, `${size} ${field}`)])
        );
        if (Object.keys(values).length === 0) {
          throw new Error(`Enter at least one custom measurement for size ${size}.`);
        }
        return {
          size_label: size,
          measurement_mode: mode,
          measurement_unit: measurementUnit,
          measurements: values,
        };
      }
      return {
        size_label: size,
        measurement_mode: mode,
        measurement_unit: measurementUnit,
        measurements: {},
      };
    });

    const commonPricing = {
      rental_price_minor: pesosToMinor(price, "Rental price"),
      security_deposit_minor: pesosToMinor(securityDeposit || "0", "Security deposit"),
      extra_day_price_minor:
        pricingMode === "fixed_duration"
          ? pesosToMinor(extraDayPrice || "0", "Extra day price")
          : "0",
      prep_minutes: daysToMinutes(prepDays || "0", "Prep days before rental", 7),
      turnaround_minutes: daysToMinutes(recoveryDays || "0", "Recovery days after return", 14),
    };

    return createClothingRequest.parse({
      name: name.trim(),
      code: code.trim(),
      description: description.trim(),
      category_id: categoryId,
      color_label: color.trim(),
      image_file_ids: imageFileIds,
      sizes,
      pricing:
        pricingMode === "fixed_duration"
          ? {
              mode: "fixed_duration",
              included_days: parseInteger(includedDays, "Included duration"),
              ...commonPricing,
            }
          : { mode: "daily", ...commonPricing },
      activate,
    });
  };

  const submitClothing = async (activate: boolean) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      setSubmitStage("Validating clothing…");
      buildCreateRequest(activate, []);
      setSubmitStage(photos.length > 0 ? "Uploading photos…" : activate ? "Adding clothing…" : "Saving draft…");
      const imageFileIds: string[] = [];
      for (const photo of photos) {
        imageFileIds.push(await uploadPhoto(photo));
      }
      setSubmitStage(activate ? "Adding clothing…" : "Saving draft…");
      const requestBody = buildCreateRequest(activate, imageFileIds);
      const fingerprint = JSON.stringify(requestBody);
      const intent =
        submitIntentRef.current?.fingerprint === fingerprint
          ? submitIntentRef.current
          : { fingerprint, key: newIntentKey("clothing") };
      submitIntentRef.current = intent;
      const result = await createDrezivoApiClient(getToken).createClothing(requestBody, intent.key);
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      router.push(`/inventory/${result.data.product_id}`);
    } catch (error) {
      if (error instanceof DrezivoApiError && (error.code === "ASSET_LIMIT_EXCEEDED" || error.code === "CAPACITY_CONFLICT")) {
        setFormError("Your workspace has reached its active clothing-piece limit. Archive unused pieces or change plan before adding more.");
      } else {
        setFormError(errorMessage(error, "Could not add clothing. Check the form and try again."));
      }
    } finally {
      setSubmitStage(null);
      setIsSubmitting(false);
    }
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
              description="Upload up to 10 JPEG, PNG, or WebP photos. The first photo becomes the cover image."
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                aria-label="Clothing photos"
                onChange={(event) => selectPhotos(event.target.files)}
              />
              <div className="flex flex-wrap gap-3">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative h-36 w-28 overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-active"
                  >
                    <img
                      src={photo.previewUrl}
                      alt={`${photo.file.name} preview`}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.id)}
                      disabled={isSubmitting}
                      aria-label={`Remove ${photo.file.name}`}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-dashboard-surface/90 text-dashboard-navy shadow-sm transition hover:bg-dashboard-active disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {index === 0 ? (
                      <span className="absolute bottom-2 left-2 rounded bg-dashboard-surface/90 px-2 py-1 text-[0.65rem] font-medium text-dashboard-navy">
                        Cover photo
                      </span>
                    ) : null}
                    {photo.status === "uploading" ? (
                      <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded bg-dashboard-surface/90 px-2 py-1 text-[0.65rem] font-medium text-dashboard-navy">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        Uploading
                      </span>
                    ) : null}
                  </div>
                ))}
                {photos.length < 10 ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-36 w-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-dashboard-border bg-dashboard-surface text-xs font-medium text-dashboard-muted transition-colors hover:border-dashboard-accent hover:bg-dashboard-active hover:text-dashboard-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ImagePlus className="h-5 w-5" aria-hidden="true" />
                    Add Photos
                    <span className="text-[0.65rem] font-normal">{photos.length}/10</span>
                  </button>
                ) : null}
              </div>
              {photos.some((photo) => photo.status === "error") ? (
                <p className="text-xs text-dashboard-danger">
                  One or more photos could not be uploaded. Retry the form submission to try again.
                </p>
              ) : null}
            </SectionCard>

            <SectionCard
              icon={Shirt}
              title="Clothing Information"
              description="These details describe the clothing style customers will see."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Clothing Name" required>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Emerald Evening Gown"
                  />
                </Field>
                <Field label="Clothing Code">
                  <div>
                    <Input
                      aria-label="Clothing Code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="e.g. GWN-023"
                    />
                    <p className="mt-1.5 text-xs text-dashboard-muted">
                      Optional. Leave blank and Drezivo will generate one for you.
                    </p>
                  </div>
                </Field>
                <Field label="Category" required>
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          disabled={
                            categoryLoading || !isLoaded || !isSignedIn || activeCategories.length === 0
                          }
                          className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
                        >
                          {selectedCategory?.name ??
                            (categoryLoading
                              ? "Loading categories…"
                              : categoryLoadError
                                ? "Could not load categories"
                                : "No active categories")}
                          <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-52">
                        {activeCategories.map((item) => (
                          <DropdownMenuItem key={item.id} onSelect={() => setCategoryId(item.id)}>
                            {item.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {!categoryLoading && (categoryLoadError || activeCategories.length === 0) ? (
                      <p className="mt-1.5 text-xs text-dashboard-muted">
                        {categoryLoadError
                          ? "Reload the page or manage your categories before continuing."
                          : "Activate a category before adding clothing."}{" "}
                        <Link
                          href="/inventory/categories"
                          className="font-medium text-dashboard-accent hover:underline"
                        >
                          Manage Categories
                        </Link>
                      </p>
                    ) : null}
                  </div>
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
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
                <Input
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder="e.g. Emerald Green"
                  className="max-w-md"
                />
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
                    <div className="flex flex-wrap gap-2">
                      {!guideLoading && !defaultGuide ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={openGuideSetup}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Add Default Size Guide
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!defaultGuide || guideLoading}
                        onClick={useDefaultGuideForAll}
                        className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:text-dashboard-navy"
                      >
                        Use default for all
                      </Button>
                    </div>
                  </div>

                  <div className="border-b border-dashboard-border p-4">
                    <div className="flex flex-col gap-3 rounded-xl border border-dashboard-border bg-dashboard-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl dashboard-tone-blue">
                          <Ruler className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-dashboard-navy">
                            {guideLoading
                              ? "Loading default measurement guide…"
                              : defaultGuide?.name ?? "No default measurement guide"}
                          </p>
                          <p className="mt-1 text-xs text-dashboard-muted">
                            {guideLoadError
                              ? "Could not load the workspace guide. Use custom/no measurements or retry."
                              : defaultGuide
                                ? "Shared guide · one stable reference reused across clothing styles"
                                : "Set a default guide or choose custom/no measurements per size."}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {defaultGuide ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setMeasurementGuideOpen(true)}
                              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:text-dashboard-navy"
                            >
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
                          </>
                        ) : !guideLoading ? (
                          <Button variant="secondary" size="sm" onClick={openGuideSetup}>
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Add Default Size Guide
                          </Button>
                        ) : null}
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
                              <DropdownMenuItem
                                disabled={!defaultGuide}
                                onSelect={() => setMeasurementMode(size, "default_guide")}
                              >
                                Default guide
                              </DropdownMenuItem>
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
                              {defaultGuide
                                ? `Uses ${defaultGuide.name}. Variant measurements remain empty.`
                                : "No default guide is configured. Choose Custom or None before submitting."}
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
                      {formatDayCount(prepDays)} before · {formatDayCount(recoveryDays)} after
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
                  <Field label="Prep Days Before Rental">
                    <div className="relative">
                      <Input
                        aria-label="Prep Days Before Rental"
                        inputMode="numeric"
                        value={prepDays}
                        onChange={(event) => setPrepDays(event.target.value)}
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span>
                    </div>
                    <p className="mt-1.5 text-xs text-dashboard-muted">
                      Days reserved for preparing the clothing before the rental starts.
                    </p>
                  </Field>
                  <Field label="Recovery Days After Return">
                    <div className="relative">
                      <Input
                        aria-label="Recovery Days After Return"
                        inputMode="numeric"
                        value={recoveryDays}
                        onChange={(event) => setRecoveryDays(event.target.value)}
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span>
                    </div>
                    <p className="mt-1.5 text-xs text-dashboard-muted">
                      Days reserved for cleaning or inspection before the clothing can be rented again.
                    </p>
                  </Field>
                  <p className="text-xs text-dashboard-muted sm:col-span-2">
                    These days keep the clothing unavailable while it is being prepared or cleaned between rentals.
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
                {formError ? (
                  <div className="flex gap-2 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-xs text-dashboard-danger" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{formError}</span>
                  </div>
                ) : null}
                {submitStage ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-dashboard-muted" aria-live="polite">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {submitStage}
                  </div>
                ) : null}
                <Button
                  variant="ghost"
                  className="w-full border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
                  disabled={isSubmitting || selectedSizes.length === 0 || !categoryId}
                  onClick={() => void submitClothing(false)}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  Save as Draft
                </Button>
                <Button
                  className="w-full"
                  disabled={isSubmitting || selectedSizes.length === 0 || !categoryId}
                  onClick={() => void submitClothing(true)}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
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

      <Sheet open={guideSetupOpen} onOpenChange={setGuideSetupOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-lg"
        >
          <div className="p-5 pr-14">
            <SheetTitle>Add Default Size Guide</SheetTitle>
            <SheetDescription className="mt-1">
              Save one reusable measurement guide for this workspace. Future clothing can reference the same guide without uploading it again.
            </SheetDescription>
          </div>

          <div className="space-y-5 border-y border-dashboard-border bg-dashboard-canvas p-5">
            <Field label="Guide Name" required>
              <Input
                aria-label="Guide Name"
                value={guideName}
                onChange={(event) => {
                  setGuideName(event.target.value);
                  guideSetupIntentRef.current = null;
                }}
                placeholder="e.g. Luna Standard Size Guide"
                disabled={isSavingGuide}
              />
            </Field>

            <div>
              <span className="mb-2 block text-sm font-medium text-dashboard-navy">
                Size Guide Image <span className="text-dashboard-danger">*</span>
              </span>
              <input
                ref={guideFileInputRef}
                type="file"
                aria-label="Default size guide image"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => selectGuideFile(event.target.files?.[0] ?? null)}
                disabled={isSavingGuide}
              />
              <button
                type="button"
                onClick={() => guideFileInputRef.current?.click()}
                disabled={isSavingGuide}
                className="flex min-h-36 w-full items-center justify-center rounded-xl border border-dashed border-dashboard-border bg-dashboard-surface p-4 text-center transition-colors hover:border-dashboard-accent hover:bg-dashboard-active disabled:cursor-not-allowed disabled:opacity-60"
              >
                {guidePreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL before governed upload finalization.
                  <img
                    src={guidePreviewUrl}
                    alt="Selected size guide preview"
                    className="max-h-72 w-full object-contain"
                  />
                ) : (
                  <span className="flex flex-col items-center gap-2 text-sm text-dashboard-muted">
                    <ImagePlus className="h-6 w-6 text-dashboard-accent" aria-hidden="true" />
                    <span className="font-medium text-dashboard-navy">Choose size guide image</span>
                    <span className="text-xs">JPEG, PNG, or WebP · up to 10 MB</span>
                  </span>
                )}
              </button>
              {guideFile ? (
                <p className="mt-2 truncate text-xs text-dashboard-muted">{guideFile.name}</p>
              ) : null}
            </div>

            {guideSetupError ? (
              <div
                className="flex gap-2 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-xs text-dashboard-danger"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{guideSetupError}</span>
              </div>
            ) : null}

            {guideSaveStage ? (
              <div className="flex items-center gap-2 text-xs text-dashboard-muted" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {guideSaveStage}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 p-5">
            <Button
              className="w-full"
              disabled={isSavingGuide || !guideName.trim() || !guideFile}
              onClick={() => void saveDefaultGuide()}
            >
              {isSavingGuide ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Save Default Size Guide
            </Button>
            <p className="text-center text-xs leading-5 text-dashboard-muted">
              The uploaded image is finalized by Drezivo before it can be saved as the reusable default.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <MeasurementGuideSheet
        guide={{
          name: defaultGuide?.name ?? "Default measurement guide",
          previewUrl: defaultGuide?.image_url ?? null,
        }}
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
            <div className="flex min-h-40 items-center justify-center bg-dashboard-active/40 p-6 text-center">
              {guide.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived governed file URL returned by the API.
                <img src={guide.previewUrl} alt={`${guide.name} preview`} className="max-h-96 w-full object-contain" />
              ) : (
                <div>
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl dashboard-tone-blue">
                    <Ruler className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-dashboard-navy">Preview unavailable</p>
                  <p className="mt-1 text-xs text-dashboard-muted">The saved size guide image could not be loaded.</p>
                </div>
              )}
            </div>
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

function newIntentKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replaceAll("-", "_")}`;
}

async function fileSha256Base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function pesosToMinor(value: string, label: string): string {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error(`${label} must be a valid peso amount with up to 2 decimal places.`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return (BigInt(whole) * 100n + BigInt(fraction || "0")).toString();
}

function parseMeasurement(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative number.`);
  }
  return parsed;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a whole number.`);
  }
  return parsed;
}

function daysToMinutes(value: string, label: string, maxDays: number): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > maxDays) {
    throw new Error(`${label} must be a whole number from 0 to ${maxDays}.`);
  }
  return days * 24 * 60;
}

function formatDayCount(value: string): string {
  const days = Number(value);
  return `${Number.isFinite(days) ? days : 0} ${days === 1 ? "day" : "days"}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
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
