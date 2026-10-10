"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Images,
  Info,
  Loader2,
  Package,
  Plus,
  Ruler,
  Save,
  Shirt,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  MAX_CLOTHING_PHOTOS,
  normalizeVariantFitRange,
  type CatalogueCategory,
  type ClothingDetail,
  type CreateClothingVariantRequest,
  type ClothingPricingInput,
  type ClothingVariantDetail,
  type MeasurementGuide,
  type UpdateClothingProductRequest,
  type UpdateClothingVariantRequest,
} from "@drezivo/contracts";

import { ArchiveClothingDialog, archiveSuccessMessage } from "@/components/inventory/archive-clothing-dialog";
import { SizingTransitionDialog } from "@/components/inventory/sizing-transition-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { inferMeasurementKind, parseMeasurementInput, type MeasurementKind } from "@/lib/measurement-input";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "ready"; item: ClothingDetail };

type PendingNavigation = { kind: "href"; href: string } | { kind: "back" };
type PricingMode = "fixed_duration" | "daily";
type MeasurementMode = "default_guide" | "custom" | "none";
type MeasurementUnit = "cm" | "in";
type PhotoStatus = "ready" | "uploading" | "uploaded" | "error";
type SubcategorySelection = "none" | "LONG" | "MINI" | "custom";
type PhotoFileId = ClothingDetail["images"][number]["file_id"];
type MeasurementGuideId = ClothingVariantDetail["measurement_guide_id"];
type MeasurementValue = ClothingVariantDetail["measurements"][string];

type VariantDraft = {
  id: string;
  sku: string;
  status: ClothingVariantDetail["status"];
  updatedAt: string;
  sizeLabel: string | null;
  color: string;
  measurementMode: MeasurementMode;
  measurementGuideId: MeasurementGuideId;
  measurementUnit: MeasurementUnit;
  fitRange: string;
  measurements: Record<string, string>;
  measurementKinds: Record<string, MeasurementKind>;
  legacyHips: Record<string, MeasurementValue>;
  pricingMode: PricingMode;
  rentalPrice: string;
  securityDeposit: string;
  includedDays: string;
  extraDayPrice: string;
  recoveryHours: string;
};

type ExistingPhoto = {
  kind: "existing";
  id: string;
  fileId: PhotoFileId;
  previewUrl: string | null;
};

type NewPhoto = {
  kind: "new";
  id: string;
  file: File;
  previewUrl: string;
  uploadKey: string;
  finalizeKey: string;
  fileId: PhotoFileId | null;
  status: PhotoStatus;
  error: string | null;
};

type EditablePhoto = ExistingPhoto | NewPhoto;

export function EditClothingPage({ productId }: { productId: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const saveGuard = useSubmitGuard();
  const resetSaveIntent = saveGuard.resetIntent;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyGuardArmedRef = useRef(false);
  const bypassPopStateRef = useRef(false);
  const initialItemRef = useRef<ClothingDetail | null>(null);

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [defaultGuide, setDefaultGuide] = useState<MeasurementGuide | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [subcategorySelection, setSubcategorySelection] = useState<SubcategorySelection>("none");
  const [customSubcategory, setCustomSubcategory] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [photos, setPhotos] = useState<EditablePhoto[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [sizingModeOpen, setSizingModeOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.status === "active"),
    [categories]
  );
  const selectedCategory =
    categories.find((category) => category.id === categoryId) ?? null;
  const editableVariants = useMemo(
    () => variants.filter((variant) => variant.status !== "archived"),
    [variants]
  );

  const load = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setLoadState({ kind: "loading" });
    setFormError(null);
    setSaveNotice(null);

    try {
      const client = createDrezivoApiClient(getToken);
      const [detailResult, categoriesResult, guideResult] = await Promise.all([
        client.getCatalogueClothingDetail(productId),
        client.getCatalogueCategories(),
        client.getDefaultMeasurementGuide().catch(() => null),
      ]);
      const item = detailResult.data;
      initialItemRef.current = item;
      setName(item.name);
      setDescription(item.description);
      const savedSubcategory = item.subcategory ?? null;
      if (savedSubcategory === "LONG" || savedSubcategory === "MINI") {
        setSubcategorySelection(savedSubcategory);
        setCustomSubcategory("");
      } else if (savedSubcategory) {
        setSubcategorySelection("custom");
        setCustomSubcategory(savedSubcategory);
      } else {
        setSubcategorySelection("none");
        setCustomSubcategory("");
      }
      setCategoryId(item.category?.id ?? null);
      setVariants(item.variants.map(variantToDraft));
      setPhotos(
        item.images
          .slice()
          .sort((a, b) => a.display_order - b.display_order)
          .map((image) => ({
            kind: "existing" as const,
            id: image.file_id,
            fileId: image.file_id,
            previewUrl: image.image_url,
          }))
      );
      setCategories(categoriesResult.data.items);
      setDefaultGuide(guideResult?.data.guide ?? null);
      setIsDirty(false);
      resetSaveIntent();
      setLoadState({ kind: "ready", item });
    } catch (error) {
      setLoadState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [getToken, isLoaded, isSignedIn, productId, resetSaveIntent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      photos.forEach((photo) => {
        if (photo.kind === "new") URL.revokeObjectURL(photo.previewUrl);
      });
    };
    // Preview URLs are intentionally cleaned up only when this page unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setFormError(null);
    setSaveNotice(null);
    resetSaveIntent();
  }, [resetSaveIntent]);

  const armHistoryGuard = useCallback(() => {
    if (historyGuardArmedRef.current) return;
    const currentState =
      window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.pushState(
      { ...currentState, __drezivoEditClothingGuard: true },
      "",
      window.location.href
    );
    historyGuardArmedRef.current = true;
  }, []);

  const stayOnPage = useCallback(() => {
    if (pendingNavigation?.kind === "back") armHistoryGuard();
    setPendingNavigation(null);
    setDiscardDialogOpen(false);
  }, [armHistoryGuard, pendingNavigation]);

  const discardChanges = useCallback(() => {
    const navigation = pendingNavigation;
    setPendingNavigation(null);
    setDiscardDialogOpen(false);
    setIsDirty(false);
    historyGuardArmedRef.current = false;
    if (!navigation) return;
    if (navigation.kind === "href") {
      router.replace(navigation.href);
      return;
    }
    bypassPopStateRef.current = true;
    window.history.back();
  }, [pendingNavigation, router]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) {
      historyGuardArmedRef.current = false;
      return;
    }
    armHistoryGuard();
    const handlePopState = () => {
      if (bypassPopStateRef.current) {
        bypassPopStateRef.current = false;
        return;
      }
      historyGuardArmedRef.current = false;
      setPendingNavigation({ kind: "back" });
      setDiscardDialogOpen(true);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [armHistoryGuard, isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation({ kind: "href", href: `${url.pathname}${url.search}${url.hash}` });
      setDiscardDialogOpen(true);
    };
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [isDirty]);

  const updateVariant = (variantId: string, patch: Partial<VariantDraft>) => {
    setVariants((current) =>
      current.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant))
    );
    markDirty();
  };

  const selectPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const availableSlots = Math.max(0, MAX_CLOTHING_PHOTOS - photos.length);
    const incoming = Array.from(files);
    if (incoming.length > availableSlots) {
      setFormError(`You can keep a maximum of ${MAX_CLOTHING_PHOTOS} photos. ${availableSlots} slot${availableSlots === 1 ? " is" : "s are"} available.`);
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
    if (!accepted.length) return;
    setPhotos((current) => [
      ...current,
      ...accepted.map((file) => ({
        kind: "new" as const,
        id: newIntentKey("edit_photo"),
        file,
        previewUrl: URL.createObjectURL(file),
        uploadKey: newIntentKey("edit_upload"),
        finalizeKey: newIntentKey("edit_finalize"),
        fileId: null,
        status: "ready" as const,
        error: null,
      })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    markDirty();
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target?.kind === "new") URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== photoId);
    });
    markDirty();
  };

  const makeCover = (photoId: string) => {
    setPhotos((current) => {
      const index = current.findIndex((photo) => photo.id === photoId);
      if (index <= 0) return current;
      const next = [...current];
      const [target] = next.splice(index, 1);
      if (target) next.unshift(target);
      return next;
    });
    markDirty();
  };

  const updateNewPhoto = (photoId: string, patch: Partial<NewPhoto>) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId && photo.kind === "new" ? { ...photo, ...patch } : photo
      )
    );
  };

  const uploadNewPhoto = async (photo: NewPhoto): Promise<PhotoFileId> => {
    if (photo.fileId) return photo.fileId;
    const client = createDrezivoApiClient(getToken);
    updateNewPhoto(photo.id, { status: "uploading", error: null });
    try {
      const sha256 = await fileSha256Base64(photo.file);
      const authorized = await client.authorizeUpload(
        {
          purpose: "catalogue_image",
          content_type: photo.file.type as "image/jpeg" | "image/png" | "image/webp",
          byte_size: photo.file.size,
          sha256,
        },
        photo.uploadKey
      );
      await uploadAuthorizedFile(
        authorized.data,
        photo.file,
        "Photo upload failed before Drezivo could accept the file."
      );
      const finalized = await client.finalizeUpload(
        authorized.data.file_id,
        photo.finalizeKey
      );
      const fileId = finalized.data.file.file_id;
      updateNewPhoto(photo.id, { fileId, status: "uploaded", error: null });
      return fileId;
    } catch (error) {
      const message = errorMessage(error, "Could not upload this photo.");
      updateNewPhoto(photo.id, { status: "error", error: message });
      throw error;
    }
  };

  const saveChanges = async () => {
    if (saveGuard.isSubmitting || loadState.kind !== "ready") return;
    const initialItem = initialItemRef.current;
    if (!initialItem) return;

    try {
      if (!name.trim()) throw new Error("Enter a clothing name.");
      const productPatch = buildProductPatch(initialItem, {
        name,
        description,
        categoryId,
        subcategorySelection,
        customSubcategory,
      });
      const variantPatches = variants
        .map((variantDraft) => {
          const initialVariant = initialItem.variants.find((variant) => variant.id === variantDraft.id);
          if (!initialVariant) throw new Error("A clothing variant is missing from the loaded item.");
          return {
            id: variantDraft.id,
            patch: buildVariantPatch(initialVariant, variantDraft, defaultGuide),
          };
        })
        .filter((entry): entry is { id: string; patch: UpdateClothingVariantRequest } => entry.patch !== null);
      const photoChanged = photosHaveChanged(initialItem, photos);

      if (!productPatch && variantPatches.length === 0 && !photoChanged) {
        setFormError("There are no changes to save.");
        return;
      }
      if (initialItem.status === "active" && photos.length === 0) {
        throw new Error("Active clothing must keep at least one catalogue photo.");
      }

      setFormError(null);
      const saved = await saveGuard.submit(async (intentKey) => {
        const client = createDrezivoApiClient(getToken);
        if (productPatch) {
          setSubmitStage("Saving clothing information…");
          await client.updateClothingProduct(productId, productPatch, `${intentKey}-product`);
        }

        for (const [index, entry] of variantPatches.entries()) {
          setSubmitStage(`Saving variant ${index + 1} of ${variantPatches.length}…`);
          await client.updateClothingVariant(
            productId,
            entry.id,
            entry.patch,
            `${intentKey}-variant-${index + 1}`
          );
        }

        if (photoChanged) {
          setSubmitStage("Uploading and saving photos…");
          const fileIds: PhotoFileId[] = [];
          for (const photo of photos) {
            fileIds.push(photo.kind === "existing" ? photo.fileId : await uploadNewPhoto(photo));
          }
          await client.replaceClothingImages(
            productId,
            { file_ids: fileIds },
            `${intentKey}-images`
          );
        }
        return true;
      });

      if (!saved) return;
      setIsDirty(false);
      historyGuardArmedRef.current = false;
      await load();
      setSaveNotice("Changes saved");
    } catch (error) {
      const apiError = toDrezivoApiError(error);
      setFormError(
        apiError.code === "STALE_VERSION"
          ? "This clothing changed while you were editing it. Reload the latest values before saving again."
          : errorMessage(error, "Could not save these clothing changes.")
      );
    } finally {
      setSubmitStage(null);
    }
  };

  if (!isLoaded || !isSignedIn || loadState.kind === "loading") {
    return <EditLoadingState />;
  }
  if (loadState.kind === "error") {
    return <EditErrorState error={loadState.error} onRetry={load} />;
  }
  if (loadState.item.status === "archived") {
    return <ArchivedEditState item={loadState.item} />;
  }

  const item = loadState.item;
  const currentSizingMode = item.sizing_mode ?? (editableVariants.some((variant) => variant.sizeLabel === null) ? "free_size" : "sized");
  const activePieces = item.variants
    .filter((variant) => variant.status !== "archived")
    .flatMap((variant) => variant.assets)
    .filter((asset) => asset.lifecycle_status === "active").length;

  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter py-6">
      <div className="mx-auto w-full max-w-screen-2xl">
        <div className="mb-5">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-dashboard-muted">
              <li>
                <Link href="/inventory" className="transition-colors hover:text-dashboard-navy">
                  Clothing
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li className="font-medium text-dashboard-navy" aria-current="page">
                Edit {item.name}
              </li>
            </ol>
          </nav>
          <h1 className="mt-3 dashboard-page-title">
            Edit Clothing
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-dashboard-muted">
            Update this clothing style, variants, photos, and pricing for future rentals. Existing reservation snapshots stay unchanged.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="space-y-4">
            <SectionCard
              icon={Images}
              title="Photos"
              description="Manage catalogue photos. The first photo is the cover image."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saveGuard.isSubmitting || photos.length >= MAX_CLOTHING_PHOTOS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  Add Photos
                </Button>
              }
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                aria-label="Add clothing photos"
                disabled={saveGuard.isSubmitting}
                onChange={(event) => selectPhotos(event.target.files)}
              />
              <p className="mb-3 text-xs text-dashboard-muted" aria-live="polite">
                {photos.length}/{MAX_CLOTHING_PHOTOS} photos
              </p>
              {photos.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-32 w-full items-center justify-center rounded-xl border border-dashed border-dashboard-border bg-dashboard-surface text-sm text-dashboard-muted transition-colors hover:border-dashboard-accent hover:bg-dashboard-active"
                >
                  <span className="flex flex-col items-center gap-2">
                    <ImagePlus className="h-5 w-5" aria-hidden="true" />
                    Add catalogue photos
                  </span>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {photos.map((photo, index) => (
                    <div
                      key={photo.id}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border bg-dashboard-active",
                        index === 0 ? "border-dashboard-accent" : "border-dashboard-border"
                      )}
                    >
                      <div className="aspect-[4/5]">
                        {photo.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed API URL or local object URL.
                          <img
                            src={photo.previewUrl}
                            alt={index === 0 ? "Current cover photo" : `Clothing photo ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-dashboard-muted">
                            Photo unavailable
                          </div>
                        )}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/65 px-2 py-1.5 text-white">
                        <button
                          type="button"
                          disabled={index === 0 || saveGuard.isSubmitting}
                          onClick={() => makeCover(photo.id)}
                          className="text-[0.68rem] font-medium disabled:opacity-70"
                        >
                          {index === 0 ? "Cover" : "Set cover"}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove photo ${index + 1}`}
                          disabled={saveGuard.isSubmitting}
                          onClick={() => removePhoto(photo.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      {photo.kind === "new" && photo.status === "uploading" ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                          <Loader2 className="h-5 w-5 animate-spin" aria-label="Uploading photo" />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              icon={Shirt}
              title="Clothing Information"
              description="These values are prefilled from the current clothing record."
            >
              <div className="grid gap-4 lg:grid-cols-3">
                <Field label="Clothing Name" required>
                  <Input
                    aria-label="Clothing Name"
                    value={name}
                    disabled={saveGuard.isSubmitting}
                    onChange={(event) => {
                      setName(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Clothing Code">
                  <div>
                    <Input aria-label="Clothing Code" value={item.code} disabled />
                    <p className="mt-1.5 text-xs text-dashboard-muted">Clothing code is stable after creation.</p>
                  </div>
                </Field>
                <Field label="Category">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={saveGuard.isSubmitting || activeCategories.length === 0}
                        className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
                      >
                        {selectedCategory?.name ?? "Uncategorized"}
                        <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-52">
                      {activeCategories.map((category) => (
                        <DropdownMenuItem
                          key={category.id}
                          onSelect={() => {
                            if (category.id !== categoryId) {
                              setCategoryId(category.id);
                              markDirty();
                            }
                          }}
                        >
                          {category.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
                <Field label="Subcategory">
                  <select
                    aria-label="Subcategory"
                    value={subcategorySelection}
                    disabled={saveGuard.isSubmitting}
                    onChange={(event) => {
                      setSubcategorySelection(event.target.value as SubcategorySelection);
                      markDirty();
                    }}
                    className="h-10 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy outline-none transition focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20 disabled:opacity-60"
                  >
                    <option value="none">None</option>
                    <option value="LONG">LONG</option>
                    <option value="MINI">MINI</option>
                    <option value="custom">Custom</option>
                  </select>
                  {subcategorySelection === "custom" ? (
                    <Input
                      aria-label="Custom subcategory"
                      value={customSubcategory}
                      maxLength={120}
                      disabled={saveGuard.isSubmitting}
                      onChange={(event) => {
                        setCustomSubcategory(event.target.value);
                        markDirty();
                      }}
                      placeholder="Enter a subcategory"
                      className="mt-2"
                    />
                  ) : null}
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  aria-label="Description"
                  rows={4}
                  value={description}
                  disabled={saveGuard.isSubmitting}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    markDirty();
                  }}
                  className="w-full resize-y rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm text-dashboard-navy outline-none transition placeholder:text-dashboard-muted focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20 disabled:opacity-60"
                />
              </Field>
            </SectionCard>

            <SectionCard
              icon={Ruler}
              title="Variants, Measurements & Pricing"
              description="Edit each existing variant independently, or switch between one flexible-fit variant and multiple labeled sizes."
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={saveGuard.isSubmitting || isDirty}
                    onClick={() => setSizingModeOpen(true)}
                  >
                    Change sizing mode
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={saveGuard.isSubmitting || isDirty || currentSizingMode === "free_size"}
                    onClick={() => setAddVariantOpen(true)}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add Variant
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-2 rounded-lg border border-dashboard-border bg-dashboard-active/25 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-dashboard-muted">Current sizing mode</span>
                <span className="font-semibold text-dashboard-accent">{currentSizingMode === "free_size" ? "One flexible-fit variant" : "Multiple labeled sizes"}</span>
              </div>
              {currentSizingMode === "free_size" ? (
                <p className="text-xs text-dashboard-muted">A flexible-fit variant may suit multiple wearer sizes. It is still one variant and does not describe how many physical pieces you own.</p>
              ) : null}
              <div className="space-y-3">
                {editableVariants.length > 0 ? (
                  editableVariants.map((variant, index) => (
                    <VariantEditor
                      key={variant.id}
                      index={index}
                      variant={variant}
                      defaultGuide={defaultGuide}
                      disabled={saveGuard.isSubmitting}
                      removeDisabled={saveGuard.isSubmitting || isDirty}
                      productId={item.product_id}
                      getToken={getToken}
                      onRemoved={(message) => {
                        void load().then(() => setSaveNotice(message));
                      }}
                      onChange={(patch) => updateVariant(variant.id, patch)}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-dashboard-border bg-dashboard-active/20 px-4 py-6 text-center text-sm text-dashboard-muted">
                    No variants remain. Add a variant to continue setting up this clothing.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl dashboard-tone-blue">
                    <Package className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-dashboard-navy">Editing Summary</h2>
                    <p className="mt-0.5 text-xs text-dashboard-muted">Current clothing structure.</p>
                  </div>
                </div>
                <div className="mt-5 divide-y divide-dashboard-border rounded-xl border border-dashboard-border">
                  <SummaryRow label="Clothing Style" value="1" />
                  <SummaryRow label="Variants" value={String(editableVariants.length)} />
                  <SummaryRow label="Active Pieces" value={String(activePieces)} />
                  <SummaryRow label="Status" value={labelize(item.status)} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {editableVariants.map((variant) => (
                    <span
                      key={variant.id}
                      className="rounded-lg border border-dashboard-border bg-dashboard-active px-2.5 py-1.5 text-xs font-semibold text-dashboard-accent"
                    >
                      {variant.sizeLabel ?? "Flexible fit"} · {variant.sku}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardContent className="space-y-3 p-5">
                {saveNotice ? (
                  <div
                    role="status"
                    className="flex gap-2 rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2.5 text-xs text-success-500"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{saveNotice}</span>
                  </div>
                ) : null}
                {formError ? (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-xs text-dashboard-danger"
                  >
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
                <Link
                  href={`/inventory/${productId}`}
                  aria-disabled={saveGuard.isSubmitting}
                  className={cn(
                    "inline-flex min-h-10 w-full items-center justify-center rounded-md border border-dashboard-border bg-dashboard-surface px-4 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                    saveGuard.isSubmitting && "pointer-events-none opacity-60"
                  )}
                >
                  Cancel
                </Link>
                <Button
                  type="button"
                  className="w-full"
                  disabled={saveGuard.isSubmitting || !isDirty}
                  onClick={() => void saveChanges()}
                >
                  {saveGuard.isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  {saveGuard.isSubmitting ? "Saving…" : "Save Changes"}
                </Button>
                <p className="text-center text-[0.68rem] leading-5 text-dashboard-muted">
                  Only future catalogue presentation and pricing change. Accepted reservation snapshots remain unchanged.
                </p>
                <div className="border-t border-dashboard-border pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saveGuard.isSubmitting || isDirty}
                    onClick={() => setArchiveOpen(true)}
                    className="w-full border border-dashboard-danger/40 text-dashboard-danger hover:bg-dashboard-danger/10 hover:text-dashboard-danger"
                  >
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    Archive Clothing
                  </Button>
                  {isDirty ? (
                    <p className="mt-2 text-center text-[0.68rem] leading-5 text-dashboard-muted">
                      Save or discard your edits before archiving this clothing.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="rounded-xl border border-dashboard-border bg-dashboard-surface p-4 text-xs text-dashboard-muted">
              <div className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
                <p>
                  Readiness, custody, reservations, and blocking allocations are operational state. Editing catalogue fields here does not rewrite them.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <SizingTransitionDialog
        activeVariants={item.variants.filter((variant) => variant.status !== "archived")}
        currentMode={currentSizingMode}
        defaultGuide={defaultGuide}
        disabled={saveGuard.isSubmitting || isDirty}
        getToken={getToken}
        onCompleted={async (data) => {
          await load();
          setSaveNotice(
            `Sizing mode changed to ${data.sizing_mode === "free_size" ? "one flexible-fit variant" : "multiple labeled sizes"} (${data.active_variant_count} active variant${data.active_variant_count === 1 ? "" : "s"}; ${data.archived_variant_count} archived).`
          );
        }}
        onOpenChange={setSizingModeOpen}
        open={sizingModeOpen}
        productId={productId}
      />

      <AddVariantDialog
        open={addVariantOpen}
        onOpenChange={setAddVariantOpen}
        productId={item.product_id}
        defaultGuide={defaultGuide}
        getToken={getToken}
        onCreated={() => {
          void load().then(() => setSaveNotice("Variant added"));
        }}
      />

      <ArchiveClothingDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        productId={item.product_id}
        name={item.name}
        updatedAt={item.updated_at}
        onArchived={(result) => {
          setIsDirty(false);
          historyGuardArmedRef.current = false;
          sessionStorage.setItem(
            "drezivo:clothing-detail-notice",
            archiveSuccessMessage(result)
          );
          router.replace(`/inventory/${productId}`);
        }}
      />

      <DiscardChangesDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          if (open) setDiscardDialogOpen(true);
          else stayOnPage();
        }}
        onStay={stayOnPage}
        onDiscard={discardChanges}
      />
    </div>
  );
}

function AddVariantDialog({
  defaultGuide,
  getToken,
  onCreated,
  onOpenChange,
  open,
  productId,
}: {
  defaultGuide: MeasurementGuide | null;
  getToken: () => Promise<string | null>;
  onCreated: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  productId: string;
}) {
  const submitGuard = useSubmitGuard();
  const [sizeLabel, setSizeLabel] = useState("");
  const [color, setColor] = useState("");
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("none");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("cm");
  const [measurements, setMeasurements] = useState<Record<string, string>>({ bust: "", waist: "", length: "" });
  const [measurementKinds, setMeasurementKinds] = useState<Record<string, MeasurementKind>>({ bust: "exact", waist: "exact", length: "exact" });
  const [pricingMode, setPricingMode] = useState<PricingMode>("fixed_duration");
  const [rentalPrice, setRentalPrice] = useState("");
  const [securityDeposit, setSecurityDeposit] = useState("0");
  const [includedDays, setIncludedDays] = useState("3");
  const [extraDayPrice, setExtraDayPrice] = useState("");
  const [recoveryHours, setRecoveryHours] = useState("24");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSizeLabel("");
    setColor("");
    setMeasurementMode("none");
    setMeasurementUnit("cm");
    setMeasurements({ bust: "", waist: "", length: "" });
    setMeasurementKinds({ bust: "exact", waist: "exact", length: "exact" });
    setPricingMode("fixed_duration");
    setRentalPrice("");
    setSecurityDeposit("0");
    setIncludedDays("3");
    setExtraDayPrice("");
    setRecoveryHours("24");
    setError(null);
    submitGuard.resetIntent();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitGuard.isSubmitting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  async function createVariant() {
    if (submitGuard.isSubmitting) return;
    setError(null);
    try {
      const draft: VariantDraft = {
        id: "new",
        sku: "New variant",
        status: "active",
        updatedAt: "",
        sizeLabel,
        color,
        measurementMode,
        measurementGuideId: measurementMode === "default_guide" ? defaultGuide?.id ?? null : null,
        measurementUnit,
        fitRange: "",
        measurements,
        measurementKinds,
        legacyHips: {},
        pricingMode,
        rentalPrice,
        securityDeposit,
        includedDays,
        extraDayPrice,
        recoveryHours,
      };
      if (!sizeLabel.trim()) throw new Error("Enter a size label.");
      const measurement = buildMeasurementPatch(draft, defaultGuide);
      const request: CreateClothingVariantRequest = {
        size_label: sizeLabel.trim(),
        color_label: color.trim() || null,
        measurement_mode: measurement.measurement_mode,
        measurement_guide_id: measurement.measurement_guide_id,
        measurement_unit: measurement.measurement_unit,
        measurements: measurement.measurements,
        fit_range: null,
        pricing: buildPricingInput(draft),
      };
      const result = await submitGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).createClothingVariant(productId, request, idempotencyKey)
      );
      if (!result) return;
      onOpenChange(false);
      reset();
      onCreated();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not add this variant."));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Add Variant</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                Add another size or color to this clothing style. In V1, each new variant automatically receives one serialized garment.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close add variant dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dashboard-muted hover:bg-dashboard-active">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Size Label" required>
                <Input aria-label="New Variant Size Label" value={sizeLabel} disabled={submitGuard.isSubmitting} onChange={(event) => setSizeLabel(event.target.value)} placeholder="e.g. XL" />
              </Field>
              <Field label="Color (optional)">
                <Input aria-label="New Variant Color" value={color} disabled={submitGuard.isSubmitting} onChange={(event) => setColor(event.target.value)} placeholder="e.g. Emerald Green" />
              </Field>
            </div>

            <div className="rounded-xl border border-dashboard-border p-4">
              <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                <Field label="Measurement Source">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" disabled={submitGuard.isSubmitting} className="w-full justify-between border border-dashboard-border">
                        {measurementMode === "none" ? "No measurements" : measurementMode === "default_guide" ? "Reusable guide" : "Custom measurements"}
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setMeasurementMode("none")}>No measurements</DropdownMenuItem>
                      {defaultGuide ? <DropdownMenuItem onSelect={() => setMeasurementMode("default_guide")}>Reusable guide</DropdownMenuItem> : null}
                      <DropdownMenuItem onSelect={() => setMeasurementMode("custom")}>Custom measurements</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
                {measurementMode === "default_guide" ? (
                  <div className="rounded-lg border border-dashboard-border bg-dashboard-active/30 p-3 text-sm text-dashboard-muted">
                    <span className="font-medium text-dashboard-navy">{defaultGuide?.name ?? "Standard Size Guide"}</span>
                    <p className="mt-1 text-xs">This variant uses the workspace reusable guide.</p>
                  </div>
                ) : measurementMode === "custom" ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <div className="inline-flex overflow-hidden rounded-md border border-dashboard-border">
                        {(["cm", "in"] as const).map((unit) => (
                          <button key={unit} type="button" onClick={() => setMeasurementUnit(unit)} className={cn("px-3 py-1.5 text-xs font-medium uppercase", measurementUnit === unit ? "bg-dashboard-active text-dashboard-accent" : "text-dashboard-muted")}>{unit}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {["bust", "waist", "length"].map((key) => (
                        <Field key={key} label={key[0]!.toUpperCase() + key.slice(1)}>
                          <Input
                            aria-label={`New Variant ${key}`}
                            inputMode="text"
                            maxLength={120}
                            value={measurements[key] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setMeasurements((current) => ({ ...current, [key]: value }));
                              setMeasurementKinds((current) => ({ ...current, [key]: inferMeasurementKind(value) }));
                            }}
                            placeholder="e.g. 36 or Flexible fit"
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashboard-border bg-dashboard-active/30 p-3 text-xs text-dashboard-muted">No structured measurements will be stored for this variant.</div>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-dashboard-navy">Pricing Model</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <PricingModeButton title="Fixed Package" description="One price for an included number of days" selected={pricingMode === "fixed_duration"} disabled={submitGuard.isSubmitting} onClick={() => setPricingMode("fixed_duration")} />
                <PricingModeButton title="Per Day" description="Rental price is charged per day" selected={pricingMode === "daily"} disabled={submitGuard.isSubmitting} onClick={() => setPricingMode("daily")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MoneyField label={pricingMode === "fixed_duration" ? "Package Price" : "Daily Rate"} required value={rentalPrice} disabled={submitGuard.isSubmitting} onChange={setRentalPrice} />
              <MoneyField label="Security Deposit" value={securityDeposit} disabled={submitGuard.isSubmitting} onChange={setSecurityDeposit} />
              {pricingMode === "fixed_duration" ? (
                <Field label="Included Duration" required>
                  <div className="relative">
                    <Input aria-label="New Variant Included Duration" inputMode="numeric" value={includedDays} disabled={submitGuard.isSubmitting} onChange={(event) => setIncludedDays(event.target.value)} className="pr-14" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span>
                  </div>
                  <p className="mt-1.5 text-xs text-dashboard-muted">Pickup day counts as Day 1. A 3-day rental is pickup, event, return.</p>
                </Field>
              ) : null}
              <MoneyField label="Extra Day Price" value={extraDayPrice} disabled={submitGuard.isSubmitting || pricingMode === "daily"} onChange={setExtraDayPrice} />
              <Field label="Recovery Time After Return">
                <div className="relative"><Input aria-label="New Variant Recovery Time" inputMode="decimal" value={recoveryHours} disabled={submitGuard.isSubmitting} onChange={(event) => setRecoveryHours(event.target.value)} className="pr-14" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">hours</span></div>
              </Field>
            </div>
          </div>

          {error ? <div role="alert" className="mt-4 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">{error}</div> : null}

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={submitGuard.isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="button" disabled={submitGuard.isSubmitting} onClick={() => void createVariant()}>
              {submitGuard.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {submitGuard.isSubmitting ? "Adding…" : "Add Variant"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function VariantEditor({
  defaultGuide,
  disabled,
  getToken,
  index,
  onChange,
  onRemoved,
  productId,
  removeDisabled,
  variant,
}: {
  defaultGuide: MeasurementGuide | null;
  disabled: boolean;
  getToken: () => Promise<string | null>;
  index: number;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemoved: (message: string) => void;
  productId: string;
  removeDisabled: boolean;
  variant: VariantDraft;
}) {
  const measurementKeys = useMemo(() => {
    const keys = new Set(["bust", "waist", "length", ...Object.keys(variant.measurements).filter((key) => !isLegacyHipsKey(key))]);
    return [...keys];
  }, [variant.measurements]);
  const guideLabel =
    variant.measurementGuideId && variant.measurementGuideId === defaultGuide?.id
      ? defaultGuide.name
      : variant.measurementGuideId
        ? "Existing reusable guide"
        : defaultGuide?.name ?? "No default guide";
  const measurementSourceSelector = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Measurement Source"
          disabled={disabled}
          className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          {measurementModeLabel(variant.measurementMode)}
          <ChevronDown className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem
          disabled={!variant.measurementGuideId && !defaultGuide}
          onSelect={() =>
            onChange({
              measurementMode: "default_guide",
              measurementGuideId: variant.measurementGuideId ?? defaultGuide?.id ?? null,
              measurements: {},
            })
          }
        >
          Reusable guide
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            onChange({
              measurementMode: "custom",
              measurementGuideId: null,
              measurements:
                Object.keys(variant.measurements).length > 0
                  ? variant.measurements
                  : { bust: "", waist: "", length: "" },
            })
          }
        >
          Custom measurements
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onChange({ measurementMode: "none", measurementGuideId: null, measurements: {} })}
        >
          No measurements
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const measurementUnitSelector = (
    <div className="flex overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface">
      {(["cm", "in"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          disabled={disabled}
          aria-pressed={variant.measurementUnit === unit}
          onClick={() => onChange({ measurementUnit: unit })}
          className={cn(
            "min-h-6 px-3 text-[0.68rem] font-medium uppercase",
            variant.measurementUnit === unit
              ? "bg-dashboard-active text-dashboard-accent"
              : "text-dashboard-muted hover:bg-dashboard-active"
          )}
        >
          {unit}
        </button>
      ))}
    </div>
  );
  const legacyHipsSummary = Object.keys(variant.legacyHips).length > 0 ? (
    <div className="mt-3 rounded-md border border-dashboard-border bg-dashboard-surface/70 px-3 py-2 text-xs text-dashboard-muted">
      <span className="font-medium text-dashboard-navy">Legacy Hips (read-only): </span>
      {Object.entries(variant.legacyHips).map(([key, value]) => `${labelize(key)}: ${typeof value === "number" ? `${value} ${variant.measurementUnit}` : value.text}`).join(" · ")}
      <span className="ml-1">This saved value is preserved when other measurements are edited.</span>
    </div>
  ) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface">
      <div className="flex flex-col gap-2 border-b border-dashboard-border bg-dashboard-active/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-dashboard-navy">Variant {index + 1} · {variant.sku}</p>
          <p className="mt-0.5 text-xs text-dashboard-muted">Existing serialized pieces stay attached to this variant.</p>
        </div>
        <VariantRemoveControl
          disabled={removeDisabled}
          getToken={getToken}
          onRemoved={onRemoved}
          productId={productId}
          variant={variant}
        />
      </div>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={variant.sizeLabel === null ? "Variant" : "Size Label"} required={variant.sizeLabel !== null}>
            <Input
              aria-label={`${variant.sku} Size Label`}
              value={variant.sizeLabel ?? "Flexible fit"}
              disabled={disabled || variant.sizeLabel === null}
              onChange={(event) => onChange({ sizeLabel: event.target.value })}
            />
          </Field>
          <Field label="Color (optional)">
            <Input
              aria-label={`${variant.sku} Color`}
              value={variant.color}
              disabled={disabled}
              placeholder="No color"
              onChange={(event) => onChange({ color: event.target.value })}
            />
          </Field>
        </div>

        {variant.sizeLabel === null ? (
          <Field label="Fits sizes (optional)">
            <Input
              aria-label={`${variant.sku} Fits sizes`}
              value={variant.fitRange}
              maxLength={120}
              disabled={disabled}
              onChange={(event) => onChange({ fitRange: event.target.value })}
              onBlur={() => onChange({ fitRange: normalizeVariantFitRange(variant.fitRange) })}
              placeholder="e.g. Small–XL"
            />
          </Field>
        ) : null}

        <div className="rounded-lg border border-dashboard-border bg-dashboard-active/25 p-4">
          {variant.measurementMode === "custom" ? (
            <div
              className="grid grid-cols-1 gap-x-3 gap-y-1 lg:grid-cols-[14rem_repeat(var(--measurement-count),minmax(0,1fr))] lg:items-end"
              style={{ "--measurement-count": measurementKeys.length } as CSSProperties}
            >
              <span className="text-xs font-medium text-dashboard-muted">Measurement Source</span>
              {measurementKeys.map((key) => (
                <div key={`${key}-label`} className={key === "length" ? "flex items-end justify-between gap-2" : undefined}>
                  <label className="hidden text-xs font-medium text-dashboard-muted lg:block" htmlFor={`${variant.id}-${key}-measurement`}>{labelize(key)}</label>
                  {key === "length" ? measurementUnitSelector : null}
                </div>
              ))}
              <div>{measurementSourceSelector}</div>
              {measurementKeys.map((key) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs font-medium text-dashboard-muted lg:hidden" htmlFor={`${variant.id}-${key}-measurement`}>{labelize(key)}</label>
                  <div className="relative">
                    <Input
                      id={`${variant.id}-${key}-measurement`}
                      aria-label={`${variant.sku} ${key}`}
                      inputMode="text"
                      value={variant.measurements[key] ?? ""}
                      maxLength={120}
                      disabled={disabled}
                      placeholder={`${labelize(key)} (e.g. 36 or Flexible fit)`}
                      onChange={(event) => onChange({
                        measurements: { ...variant.measurements, [key]: event.target.value },
                        measurementKinds: { ...variant.measurementKinds, [key]: inferMeasurementKind(event.target.value) },
                      })}
                      className={(variant.measurementKinds[key] ?? "exact") === "exact" ? "pr-10" : undefined}
                    />
                    {(variant.measurementKinds[key] ?? "exact") === "exact" ? (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase text-dashboard-muted">{variant.measurementUnit}</span>
                    ) : null}
                  </div>
                </div>
              ))}
              {legacyHipsSummary ? <div className="lg:col-span-full">{legacyHipsSummary}</div> : null}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
              <Field label="Measurement Source">{measurementSourceSelector}</Field>
              {variant.measurementMode === "default_guide" ? (
                <div className="rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-3 text-xs text-dashboard-muted">
                  <p className="font-medium text-dashboard-navy">{guideLabel}</p>
                  <p className="mt-1">This variant keeps a stable guide reference unless you explicitly change its source.</p>
                </div>
              ) : (
                <p className="self-center text-xs text-dashboard-muted">No measurement data is attached to this variant.</p>
              )}
              {legacyHipsSummary ? <div className="lg:col-span-full">{legacyHipsSummary}</div> : null}
            </div>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-dashboard-navy">Pricing Model</label>
          <div className="grid gap-2 sm:grid-cols-2">
            <PricingModeButton
              selected={variant.pricingMode === "fixed_duration"}
              title="Fixed Package"
              description="One price for an included number of days"
              disabled={disabled}
              onClick={() => onChange({ pricingMode: "fixed_duration" })}
            />
            <PricingModeButton
              selected={variant.pricingMode === "daily"}
              title="Per Day"
              description="Rental price is charged per day"
              disabled={disabled}
              onClick={() => onChange({ pricingMode: "daily" })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField
            label={variant.pricingMode === "daily" ? "Daily Rate" : "Package Price"}
            value={variant.rentalPrice}
            disabled={disabled}
            required
            onChange={(value) => onChange({ rentalPrice: value })}
          />
          <MoneyField
            label="Security Deposit"
            value={variant.securityDeposit}
            disabled={disabled}
            onChange={(value) => onChange({ securityDeposit: value })}
          />
          {variant.pricingMode === "fixed_duration" ? (
            <Field label="Included Duration" required>
              <div className="relative">
                <Input
                  aria-label={`${variant.sku} Included Duration`}
                  inputMode="numeric"
                  value={variant.includedDays}
                  disabled={disabled}
                  onChange={(event) => onChange({ includedDays: event.target.value })}
                  className="pr-14"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">days</span>
              </div>
              <p className="mt-1.5 text-xs text-dashboard-muted">Pickup day counts as Day 1. A 3-day rental is pickup, event, return.</p>
            </Field>
          ) : null}
          <MoneyField
            label="Extra Day Price"
            value={variant.extraDayPrice}
            disabled={disabled || variant.pricingMode === "daily"}
            onChange={(value) => onChange({ extraDayPrice: value })}
          />
          <Field label="Recovery After Return">
            <div className="relative">
              <Input
                aria-label={`${variant.sku} Recovery After Return`}
                inputMode="decimal"
                value={variant.recoveryHours}
                disabled={disabled}
                onChange={(event) => onChange({ recoveryHours: event.target.value })}
                className="pr-14"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-dashboard-muted">hours</span>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

function VariantRemoveControl({
  disabled,
  getToken,
  onRemoved,
  productId,
  variant,
}: {
  disabled: boolean;
  getToken: () => Promise<string | null>;
  onRemoved: (message: string) => void;
  productId: string;
  variant: VariantDraft;
}) {
  const removeGuard = useSubmitGuard();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionsDisabled = disabled || removeGuard.isSubmitting;

  async function removeVariant() {
    if (actionsDisabled) return;
    setError(null);
    try {
      const result = await removeGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).removeClothingVariant(
          productId,
          variant.id,
          { expected_updated_at: variant.updatedAt },
          idempotencyKey
        )
      );
      if (!result) return;
      removeGuard.resetIntent();
      setRemoveOpen(false);
      onRemoved(
        result.data.outcome === "deleted"
          ? "Variant removed."
          : "Variant removed. Existing physical-piece and rental history was preserved."
      );
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={actionsDisabled}
        onClick={() => setRemoveOpen(true)}
        aria-label={`Remove ${variant.sku}`}
        className="border border-dashboard-danger/40 text-dashboard-danger hover:bg-dashboard-danger/10 hover:text-dashboard-danger"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Remove
      </Button>
      {disabled && !removeGuard.isSubmitting ? (
        <span className="text-[0.68rem] text-dashboard-muted">Save current edits before removing this variant.</span>
      ) : null}
      {error ? <span role="alert" className="max-w-md text-right text-xs text-dashboard-danger">{error}</span> : null}

      <Dialog.Root
        open={removeOpen}
        onOpenChange={(open: boolean) => !removeGuard.isSubmitting && setRemoveOpen(open)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
            <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Remove {variant.sku}?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-dashboard-muted">
              This removes the variant from normal clothing management. If it already has physical pieces or rental history, Drezivo keeps that historical data intact.
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={removeGuard.isSubmitting}
                onClick={() => setRemoveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={removeGuard.isSubmitting}
                onClick={() => void removeVariant()}
                className="bg-dashboard-danger text-dashboard-primary-ink hover:bg-dashboard-danger/90"
              >
                {removeGuard.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
                {removeGuard.isSubmitting ? "Removing…" : "Remove Variant"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function DiscardChangesDialog({
  onDiscard,
  onOpenChange,
  onStay,
  open,
}: {
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
  onStay: () => void;
  open: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
            Discard unsaved changes?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-dashboard-muted">
            You have changes that haven&apos;t been saved. Leaving this page will discard them.
          </Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onStay}>
              Stay on page
            </Button>
            <Button
              type="button"
              onClick={onDiscard}
              className="bg-dashboard-danger text-dashboard-primary-ink hover:bg-dashboard-danger/90"
            >
              Discard changes
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SectionCard({
  action,
  children,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg dashboard-tone-blue">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-dashboard-navy">{title}</h2>
              <p className="mt-0.5 text-xs text-dashboard-muted">{description}</p>
            </div>
          </div>
          {action}
        </div>
        <div className="space-y-4">{children}</div>
      </CardContent>
    </Card>
  );
}

function Field({ children, label, required = false }: { children: ReactNode; label: string; required?: boolean }) {
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
  disabled = false,
  label,
  onChange,
  required = false,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <Field label={label} required={required}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-dashboard-muted">₱</span>
        <Input
          aria-label={label}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="pl-7"
        />
      </div>
    </Field>
  );
}

function PricingModeButton({
  description,
  disabled,
  onClick,
  selected,
  title,
}: {
  description: string;
  disabled: boolean;
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-16 items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60",
        selected
          ? "border-dashboard-accent bg-dashboard-active text-dashboard-navy"
          : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-dashboard-accent" : "border-dashboard-border"
        )}
      >
        {selected ? <Check className="h-3 w-3 text-dashboard-accent" aria-hidden="true" /> : null}
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs">{description}</span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
      <span className="text-dashboard-muted">{label}</span>
      <span className="font-semibold text-dashboard-navy">{value}</span>
    </div>
  );
}

function EditLoadingState() {
  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter py-6">
      <div className="mx-auto flex min-h-80 w-full max-w-screen-2xl items-center justify-center rounded-xl border border-dashboard-border bg-dashboard-surface text-sm text-dashboard-muted">
        Loading clothing values…
      </div>
    </div>
  );
}

function EditErrorState({ error, onRetry }: { error: DrezivoApiError; onRetry: () => Promise<void> }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter py-6">
      <div className="mx-auto flex min-h-80 w-full max-w-screen-2xl flex-col items-center justify-center gap-4 rounded-xl border border-dashboard-border bg-dashboard-surface px-6 text-center">
        <AlertCircle className="h-8 w-8 text-dashboard-muted" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold text-dashboard-navy">Could not load clothing for editing</h1>
          <p className="mt-1 max-w-lg text-sm text-dashboard-muted">{error.message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory" className="inline-flex min-h-10 items-center rounded-md border border-dashboard-border px-4 text-sm font-medium text-dashboard-navy hover:bg-dashboard-active">
            Back to Clothing
          </Link>
          <Button type="button" onClick={() => void onRetry()}>Try again</Button>
        </div>
      </div>
    </div>
  );
}

function ArchivedEditState({ item }: { item: ClothingDetail }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter py-6">
      <div className="mx-auto flex min-h-80 w-full max-w-screen-2xl flex-col items-center justify-center gap-4 rounded-xl border border-dashboard-border bg-dashboard-surface px-6 text-center">
        <Package className="h-8 w-8 text-dashboard-muted" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold text-dashboard-navy">This clothing is archived</h1>
          <p className="mt-1 max-w-lg text-sm text-dashboard-muted">
            {item.name} remains readable for history, but Drezivo does not expose a restore/reactivation command yet.
          </p>
        </div>
        <Link href={`/inventory/${item.product_id}`} className="inline-flex min-h-10 items-center rounded-md border border-dashboard-border px-4 text-sm font-medium text-dashboard-navy hover:bg-dashboard-active">
          View clothing details
        </Link>
      </div>
    </div>
  );
}

function buildProductPatch(
  initial: ClothingDetail,
  current: {
    name: string;
    description: string;
    categoryId: string | null;
    subcategorySelection: SubcategorySelection;
    customSubcategory: string;
  }
): UpdateClothingProductRequest | null {
  const patch: Partial<UpdateClothingProductRequest> & { expected_updated_at: string } = {
    expected_updated_at: initial.updated_at,
  };
  if (current.name.trim() !== initial.name) patch.name = current.name.trim();
  if (current.description.trim() !== initial.description) patch.description = current.description.trim();
  if ((current.categoryId ?? null) !== (initial.category?.id ?? null)) {
    if (!current.categoryId) throw new Error("Choose an active category before saving this change.");
    patch.category_id = current.categoryId as UpdateClothingProductRequest["category_id"];
  }
  const subcategory =
    current.subcategorySelection === "LONG" || current.subcategorySelection === "MINI"
      ? current.subcategorySelection
      : current.subcategorySelection === "custom"
        ? current.customSubcategory.trim() || null
        : null;
  if (subcategory !== (initial.subcategory ?? null)) patch.subcategory = subcategory;
  return Object.keys(patch).length > 1 ? (patch as UpdateClothingProductRequest) : null;
}

function buildVariantPatch(
  initial: ClothingVariantDetail,
  draft: VariantDraft,
  defaultGuide: MeasurementGuide | null
): UpdateClothingVariantRequest | null {
  const patch: Partial<UpdateClothingVariantRequest> & { expected_updated_at: string } = {
    expected_updated_at: initial.updated_at,
  };
  if (initial.size_label !== null) {
    const sizeLabel = draft.sizeLabel?.trim() ?? "";
    if (!sizeLabel) throw new Error(`Enter a size label for ${initial.sku}.`);
    if (sizeLabel !== initial.size_label) patch.size_label = sizeLabel;
  }
  const fitRange = normalizeVariantFitRange(draft.fitRange) || null;
  if (initial.fit_range !== fitRange) {
    patch.fit_range = fitRange;
  }

  const color = draft.color.trim() || null;
  if (color !== initial.color_label) patch.color_label = color;

  const measurement = buildMeasurementPatch(draft, defaultGuide);
  const initialMeasurement = {
    measurement_mode: initial.measurement_mode,
    measurement_guide_id: initial.measurement_guide_id,
    measurement_unit: initial.measurement_unit,
    measurements: initial.measurements,
  };
  if (stableStringify(measurement) !== stableStringify(initialMeasurement)) {
    patch.measurement = measurement;
  }

  const pricing = buildPricingInput(draft);
  const initialPricing = variantPricingFromDetail(initial);
  if (stableStringify(pricing) !== stableStringify(initialPricing)) patch.pricing = pricing;

  return Object.keys(patch).length > 1 ? (patch as UpdateClothingVariantRequest) : null;
}

function buildMeasurementPatch(
  draft: VariantDraft,
  defaultGuide: MeasurementGuide | null
): NonNullable<UpdateClothingVariantRequest["measurement"]> {
  if (draft.measurementMode === "default_guide") {
    const guideId = draft.measurementGuideId ?? defaultGuide?.id ?? null;
    if (!guideId) throw new Error(`Choose a reusable measurement guide for ${draft.sku}.`);
    return {
      measurement_mode: "default_guide",
      measurement_guide_id: guideId,
      measurement_unit: draft.measurementUnit,
      measurements: {},
    };
  }
  if (draft.measurementMode === "none") {
    return {
      measurement_mode: "none",
      measurement_guide_id: null,
      measurement_unit: draft.measurementUnit,
      measurements: {},
    };
  }
  const measurements = Object.fromEntries(
    Object.entries(draft.measurements)
      .filter(([, value]) => value.trim() !== "")
      .map(([key, value]) => [key, parseMeasurementInput(value, `${draft.sku} ${key}`, draft.measurementKinds[key] ?? "exact", true)])
  );
  for (const [key, value] of Object.entries(draft.legacyHips)) measurements[key] = value;
  if (Object.keys(measurements).length === 0) {
    throw new Error(`Enter at least one custom measurement or fit note for ${draft.sku}.`);
  }
  return {
    measurement_mode: "custom",
    measurement_guide_id: null,
    measurement_unit: draft.measurementUnit,
    measurements,
  };
}

function buildPricingInput(draft: VariantDraft): ClothingPricingInput {
  const common = {
    rental_price_minor: pesosToMinor(draft.rentalPrice, `${draft.sku} rental price`),
    security_deposit_minor: pesosToMinor(draft.securityDeposit || "0", `${draft.sku} security deposit`),
    extra_day_price_minor: pesosToMinor(draft.extraDayPrice || draft.rentalPrice, `${draft.sku} extra day price`),
    prep_minutes: 0 as const,
    turnaround_minutes: hoursToMinutes(draft.recoveryHours || "0", `${draft.sku} recovery after return`),
  };
  if (draft.pricingMode === "daily") return { mode: "daily", ...common };
  const includedDays = Number(draft.includedDays);
  if (!Number.isInteger(includedDays) || includedDays < 1 || includedDays > 30) {
    throw new Error(`${draft.sku} included duration must be a whole number from 1 to 30 days.`);
  }
  return { mode: "fixed_duration", included_days: includedDays, ...common };
}

function variantPricingFromDetail(variant: ClothingVariantDetail): ClothingPricingInput {
  const common = {
    rental_price_minor: variant.rental_price_minor,
    security_deposit_minor: variant.security_deposit_minor,
    extra_day_price_minor: variant.extra_day_price_minor,
    prep_minutes: 0 as const,
    turnaround_minutes: variant.turnaround_minutes,
  };
  if (variant.pricing_mode === "daily") return { mode: "daily", ...common };
  return {
    mode: "fixed_duration",
    included_days: variant.included_duration_minutes / (24 * 60),
    ...common,
  };
}

function variantToDraft(variant: ClothingVariantDetail): VariantDraft {
  const entries = Object.entries(variant.measurements);
  const legacyHips = Object.fromEntries(entries.filter(([key]) => isLegacyHipsKey(key)));
  const editableEntries = entries.filter(([key]) => !isLegacyHipsKey(key));
  return {
    id: variant.id,
    sku: variant.sku,
    status: variant.status,
    updatedAt: variant.updated_at,
    sizeLabel: variant.size_label,
    color: variant.color_label ?? "",
    measurementMode: variant.measurement_mode,
    measurementGuideId: variant.measurement_guide_id,
    measurementUnit: variant.measurement_unit,
    fitRange: variant.fit_range ? normalizeVariantFitRange(variant.fit_range) : "",
    measurements: Object.fromEntries(
      editableEntries.map(([key, value]) => [key, typeof value === "number" ? String(value) : value.text])
    ),
    measurementKinds: Object.fromEntries(editableEntries.map(([key, value]) => [key, typeof value === "number" ? "exact" : "fit_note"])),
    legacyHips,
    pricingMode: variant.pricing_mode,
    rentalPrice: minorToPesos(variant.rental_price_minor),
    securityDeposit: minorToPesos(variant.security_deposit_minor),
    includedDays: String(variant.included_duration_minutes / (24 * 60)),
    extraDayPrice: minorToPesos(variant.extra_day_price_minor),
    recoveryHours: formatDecimal(variant.turnaround_minutes / 60),
  };
}

function isLegacyHipsKey(key: string): boolean {
  return key.trim().replace(/[_\s]+/g, " ").toLocaleLowerCase() === "hips";
}

function photosHaveChanged(initial: ClothingDetail, current: EditablePhoto[]): boolean {
  if (current.some((photo) => photo.kind === "new")) return true;
  const initialIds = initial.images
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((image) => image.file_id);
  const currentIds = current.map((photo) => photo.fileId);
  return stableStringify(initialIds) !== stableStringify(currentIds);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)])
    );
  }
  return value;
}

function newIntentKey(prefix: string): string {
  const value = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

async function fileSha256Base64(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
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
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(minutes)) {
    throw new Error(`${label} must be a valid non-negative number of hours.`);
  }
  return minutes;
}

function minorToPesos(value: string): string {
  return formatDecimal(Number(value) / 100);
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function measurementModeLabel(mode: MeasurementMode): string {
  if (mode === "default_guide") return "Reusable guide";
  if (mode === "custom") return "Custom measurements";
  return "No measurements";
}

function labelize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError(errorMessage(error, "Could not load clothing."), { status: 500 });
}
