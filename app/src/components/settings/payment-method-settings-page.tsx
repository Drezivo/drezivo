"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CheckCircle2,
  CreditCard,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  MAX_ONLINE_PAYMENT_METHODS,
  type FileObjectId,
  type PaymentMethodPresentation,
  type PaymentMethodSettingsItem,
  type PaymentRenterStepsSetting,
} from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { mediaImageSrcSet } from "@/lib/media-image-srcset";
import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { useRequestPlanUpgrade } from "@/components/billing/plan-upgrade-dialog";
import { detectImageType, STOREFRONT_IMAGE_MAX_BYTES, storefrontImageProblem, uploadStorefrontImage, type ImageUploadPurpose, type UploadIntent } from "@/lib/storefront-assets";
import { useSubmitGuard } from "@/lib/use-submit-guard";

/** Common Philippine options offered as suggestions; any other name can be typed. */
const METHOD_SUGGESTIONS = [
  "GCash",
  "Maya",
  "GoTyme",
  "ShopeePay",
  "BDO",
  "BPI",
  "Metrobank",
  "UnionBank",
  "Security Bank",
  "RCBC",
  "Landbank",
  "PNB",
  "China Bank",
  "InstaPay transfer",
  "PESONet transfer",
];

/** E-wallets whose account number is an 11-digit Philippine mobile number. */
const MOBILE_WALLETS = new Set(["gcash", "maya"]);

const isOnline = (method: PaymentMethodSettingsItem) => method.rail !== "cash";

export function PaymentMethodSettingsPage() {
  const { getToken } = useAuth();
  const actor = useVerifiedActorContext();
  const storefrontLocked = actor?.entitlements.features.storefront_payments === false;
  const requestUpgrade = useRequestPlanUpgrade();
  const [methods, setMethods] = useState<PaymentMethodSettingsItem[]>([]);
  const [renterSteps, setRenterSteps] = useState<PaymentRenterStepsSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void createDrezivoApiClient(getToken)
      .getPaymentMethodSettings()
      .then((result) => {
        if (!cancelled) {
          setMethods(result.data.items);
          setRenterSteps(result.data.renter_steps);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught, "Could not load payment methods."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const upsert = (saved: PaymentMethodSettingsItem) =>
    setMethods((current) =>
      current.some((item) => item.id === saved.id) ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved],
    );

  const inUse = methods.filter((method) => method.active);
  const removed = methods.filter((method) => !method.active && isOnline(method));
  const onlineInUse = inUse.filter(isOnline).length;
  const atLimit = onlineInUse >= MAX_ONLINE_PAYMENT_METHODS;
  // Cash first, then online methods in the order they were added.
  const ordered = [...inUse.filter((method) => !isOnline(method)), ...inUse.filter(isOnline)];

  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* The page title comes from the Settings layout (SettingsHeading). */}
          <p className="max-w-2xl text-sm text-dashboard-muted">
            Set up to {MAX_ONLINE_PAYMENT_METHODS} online payment methods (e-wallets or banks). Each method keeps its own account details, QR image, or full instructions file; renter steps are shared once below.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button type="button" onClick={() => setAdding(true)} disabled={loading || atLimit || adding}>
            <Plus className="mr-2 h-4 w-4" /> Add payment method
          </Button>
          <span className="text-xs text-dashboard-muted">
            {atLimit
              ? `All ${MAX_ONLINE_PAYMENT_METHODS} online methods are in use. Remove one to add another.`
              : `${onlineInUse} of ${MAX_ONLINE_PAYMENT_METHODS} online methods in use`}
          </span>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-dashboard-danger">
          {error}
        </div>
      ) : null}

      {storefrontLocked ? (
        <p className="mb-4 rounded-lg border border-dashboard-border bg-dashboard-active/40 px-4 py-3 text-sm text-dashboard-muted">
          Free includes payment methods for staff-created reservations. Storefront payment options are available on paid plans. {" "}
          <button type="button" className="font-semibold text-dashboard-accent underline underline-offset-2" onClick={() => requestUpgrade("storefront payment methods")}>Upgrade to unlock</button>
        </p>
      ) : null}

      {adding ? <AddPaymentMethodCard storefrontLocked={storefrontLocked} onCancel={() => setAdding(false)} onCreated={(created) => { upsert(created); setAdding(false); }} /> : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-dashboard-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading payment methods…
        </div>
      ) : (
        <div className="grid gap-4">
          {ordered.map((method) => (
            <PaymentMethodEditor key={method.id} method={method} storefrontLocked={storefrontLocked === true} onSaved={upsert} />
          ))}
        </div>
      )}

      {removed.length > 0 ? (
        <section className="mt-8" aria-labelledby="removed-methods">
          <h3 id="removed-methods" className="text-sm font-semibold text-dashboard-navy">
            Removed methods
          </h3>
          <p className="mt-1 text-xs text-dashboard-muted">Past reservations keep the details they were made with. Restore a method to use it again.</p>
          <ul className="mt-3 grid gap-2">
            {removed.map((method) => (
              <RemovedMethodRow key={method.id} method={method} disabled={atLimit} onRestored={upsert} />
            ))}
          </ul>
        </section>
      ) : null}
      {!loading && renterSteps ? <SharedRenterStepsCard setting={renterSteps} onSaved={setRenterSteps} /> : null}
    </div>
  );
}

function SharedRenterStepsCard({ setting, onSaved }: { setting: PaymentRenterStepsSetting; onSaved: (saved: PaymentRenterStepsSetting) => void }) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [mode, setMode] = useState<"text" | "image">(setting.image ? "image" : "text");
  const [text, setText] = useState(setting.text ?? "");
  const [fileId, setFileId] = useState<FileObjectId | null>(setting.image?.file_id ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [savedPreview, setSavedPreview] = useState<SavedPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadIntentRef = useRef<UploadIntent | null>(null);
  const inputId = useId();
  const busy = uploading || guard.isSubmitting;
  const localUrl = useObjectUrl(file ?? (savedPreview?.fileId === fileId ? savedPreview.file : null));
  const imageUrl = file ? localUrl : savedPreview?.fileId === fileId ? localUrl : setting.image?.file_id === fileId ? setting.image.image_url ?? null : null;

  async function save() {
    if (busy) return;
    setMessage(null);
    if (mode === "image" && !fileId && !file) {
      setMessage("Upload an image of the steps for renters before saving.");
      return;
    }
    try {
      let nextFileId = fileId;
      if (mode === "image" && file) {
        if (file.size > STOREFRONT_IMAGE_MAX_BYTES) {
          setMessage("Images must be 10 MB or smaller.");
          return;
        }
        await detectImageType(file);
        setUploading(true);
        try {
          nextFileId = await uploadStorefrontImage(file, getToken, uploadIntentRef, "payment_method_material");
        } finally {
          setUploading(false);
        }
        setFileId(nextFileId);
        setSavedPreview({ fileId: nextFileId, file });
        setFile(null);
      }

      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updatePaymentRenterSteps(
          {
            version: setting.version,
            text: mode === "text" ? text.trim() || null : null,
            image_file_id: mode === "image" ? nextFileId : null,
          },
          idempotencyKey,
        ),
      );
      if (!result) return;
      onSaved(result.data);
      setText(result.data.text ?? "");
      setFileId(result.data.image?.file_id ?? null);
      setMessage("Saved.");
      uploadIntentRef.current = null;
    } catch (caught) {
      setMessage(errorMessage(caught, "Could not save renter steps."));
    }
  }

  async function pickImage(picked: File | null) {
    if (!picked) return;
    if (picked.size > STOREFRONT_IMAGE_MAX_BYTES) {
      setMessage("Images must be 10 MB or smaller.");
      return;
    }
    try {
      await detectImageType(picked);
      setFile(picked);
      setFileId(null);
      uploadIntentRef.current = null;
      setMessage(null);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Choose a JPEG, PNG, or WebP image.");
    }
  }

  return (
    <Card data-mobile-card="keep" className="mt-8 gap-0 border-dashboard-accent/30 py-0">
      <CardContent className="p-5">
        <h2 className="text-base font-semibold text-dashboard-navy">Steps for renters</h2>
        <p className="mt-1 text-sm text-dashboard-muted">One guide is shown with every online payment method in your storefront.</p>

        {setting.legacy_conflicts.length > 0 ? (
          <section className="mt-4 rounded-lg border border-dashboard-gold-text/40 bg-dashboard-active/40 p-4" aria-labelledby="legacy-renter-steps-title">
            <h3 id="legacy-renter-steps-title" className="text-sm font-semibold text-dashboard-navy">Review existing method-specific steps</h3>
            <p className="mt-1 text-xs leading-5 text-dashboard-muted">
              These payment methods had separate renter steps, so none were chosen automatically. Their original values are preserved. Save one shared guide below to use the same steps for every online method.
            </p>
            <ul className="mt-3 grid gap-3">
              {setting.legacy_conflicts.map((legacy) => (
                <li key={legacy.payment_method_id} className="rounded-md border border-dashboard-border bg-dashboard-surface p-3">
                  <h4 className="text-sm font-medium text-dashboard-navy">{legacy.payment_method_name}</h4>
                  {legacy.text ? <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-dashboard-muted select-text">{legacy.text}</pre> : null}
                  {legacy.image?.image_url ? (
                    <div className="mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed legacy guide preview */}
                      <img src={legacy.image.image_url} alt={`${legacy.payment_method_name} renter steps`} className="mb-2 max-h-48 w-auto rounded-lg border border-dashboard-border bg-dashboard-surface object-contain" />
                      <a className="text-xs text-dashboard-accent underline" href={legacy.image.image_url} target="_blank" rel="noreferrer">Open existing image</a>
                    </div>
                  ) : legacy.image ? <p className="mt-2 text-xs text-dashboard-muted">Existing image could not be previewed.</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-dashboard-navy">Choose how to provide the steps</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              { value: "text", label: "Enter steps for renters", description: "Write a short guide that applies to every method." },
              { value: "image", label: "Upload steps for renters", description: "Share one JPEG, PNG, or WebP image, up to 10 MB." },
            ] as const).map((option) => (
              <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dashboard-accent/40 ${mode === option.value ? "border-dashboard-accent bg-dashboard-active/50" : "border-dashboard-border"}`}>
                <input type="radio" name="shared-renter-steps-mode" className="mt-1" checked={mode === option.value} onChange={() => { setMode(option.value); setMessage(null); }} />
                <span>
                  <span className="block text-sm font-medium text-dashboard-navy">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-dashboard-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "text" ? (
          <Field label="Text steps for renters" className="mt-4 block">
            <Textarea value={text} maxLength={2_000} onChange={(event) => { setText(event.target.value); setMessage(null); }} />
          </Field>
        ) : (
          <div className="mt-4">
            <label className="text-sm font-medium text-dashboard-navy" htmlFor={inputId}>Steps image</label>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed or local object URL
              <img src={imageUrl} alt="Renter steps image" className="mb-2 max-h-48 w-auto rounded-lg border border-dashboard-border bg-dashboard-surface object-contain" />
            ) : null}
            <input
              id={inputId}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => { const picked = event.target.files?.[0] ?? null; event.target.value = ""; void pickImage(picked); }}
            />
            <label htmlFor={inputId} className="mt-2 flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-dashboard-border bg-dashboard-canvas/60 px-4 py-4 transition-colors hover:border-dashboard-accent/60 hover:bg-dashboard-active/40">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent"><UploadCloud className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-dashboard-navy">{file?.name ?? (fileId ? "Replace image" : "Choose an image")}</span>
                <span className="mt-1 block text-xs leading-5 text-dashboard-muted">JPEG, PNG, or WebP up to 10 MB.</span>
              </span>
              <span className="shrink-0 rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-1.5 text-xs font-medium text-dashboard-navy">{fileId ? "Change" : "Browse"}</span>
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashboard-border pt-4">
          <p className="text-xs text-dashboard-muted" role={message && message !== "Saved." ? "alert" : undefined}>{message}</p>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {busy ? "Saving…" : "Save renter steps"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddPaymentMethodCard({ storefrontLocked, onCancel, onCreated }: { storefrontLocked: boolean; onCancel: () => void; onCreated: (created: PaymentMethodSettingsItem) => void }) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const listId = useId();
  const [name, setName] = useState("");
  const [rail, setRail] = useState<"manual_qr" | "manual_transfer">("manual_qr");
  const [presentation, setPresentation] = useState<PaymentMethodPresentation>("details");
  const [message, setMessage] = useState<string | null>(null);

  async function create() {
    if (guard.isSubmitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Enter a name, for example GCash or BPI.");
      return;
    }
    setMessage(null);
    try {
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).createPaymentMethod(
          {
            name: trimmed,
            rail,
            // Free keeps new methods staff-only; renters cannot pay through a Free storefront.
            storefront_enabled: !storefrontLocked,
            destination: { account_name: null, account_number: null, instructions: null },
            qr_file_id: null,
            presentation: "details",
            material_file_id: null,
          },
          idempotencyKey,
        ),
      );
      if (!result) return;
      // Material is uploaded in the method's editor; start it in the chosen mode.
      onCreated({ ...result.data, presentation });
    } catch (caught) {
      setMessage(errorMessage(caught, "Could not add this payment method."));
    }
  }

  return (
    <Card data-mobile-card="keep" className="mb-4 gap-0 border-dashboard-accent/40 py-0">
      <CardContent className="p-5">
        <p className="text-base font-semibold text-dashboard-navy">New payment method</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              list={listId}
              value={name}
              maxLength={80}
              placeholder="GCash, Maya, BPI…"
              onChange={(event) => {
                setName(event.target.value);
                guard.resetIntent();
              }}
            />
            <datalist id={listId}>
              {METHOD_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </Field>
          <Field label="How renters pay">
            <select
              className="h-9 w-full rounded-md border border-dashboard-border bg-transparent px-3 text-sm text-dashboard-navy"
              value={rail}
              onChange={(event) => {
                setRail(event.target.value as "manual_qr" | "manual_transfer");
                guard.resetIntent();
              }}
            >
              <option value="manual_qr">Scan a QR code</option>
              <option value="manual_transfer">Send to an account number</option>
            </select>
          </Field>
        </div>
        <PresentationChoice value={presentation} onChange={setPresentation} />
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-dashboard-border pt-4">
          <p className="text-xs text-dashboard-muted" role={message ? "alert" : undefined}>
            {message ?? "You can fill in the details or upload your file right after adding it."}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={guard.isSubmitting}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void create()} disabled={guard.isSubmitting}>
              {guard.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {guard.isSubmitting ? "Adding…" : "Add method"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PresentationChoice({ value, onChange }: { value: PaymentMethodPresentation; onChange: (value: PaymentMethodPresentation) => void }) {
  const options: Array<{ value: PaymentMethodPresentation; label: string; description: string }> = [
    { value: "details", label: "Type the details", description: "Account name, number, and an optional QR image." },
    { value: "material", label: "Upload my instructions", description: "A PDF or image for this specific payment method." },
  ];
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium text-dashboard-navy">What renters see</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dashboard-accent/40 ${
              value === option.value ? "border-dashboard-accent bg-dashboard-active/50" : "border-dashboard-border"
            }`}
          >
            <input type="radio" className="mt-1" checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>
              <span className="block text-sm font-medium text-dashboard-navy">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-dashboard-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PaymentMethodEditor({ method, storefrontLocked, onSaved }: { method: PaymentMethodSettingsItem; storefrontLocked: boolean; onSaved: (saved: PaymentMethodSettingsItem) => void }) {
  const { getToken } = useAuth();
  const requestUpgrade = useRequestPlanUpgrade();
  const saveGuard = useSubmitGuard();
  const removeGuard = useSubmitGuard();
  const [active, setActive] = useState(method.active);
  const [storefrontEnabled, setStorefrontEnabled] = useState(method.storefront_enabled);
  const [accountName, setAccountName] = useState(method.destination.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(method.destination.account_number ?? "");
  const [presentation, setPresentation] = useState<PaymentMethodPresentation>(method.presentation);
  const [qrFileId, setQrFileId] = useState<FileObjectId | null>(method.qr_file_id);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [materialFileId, setMaterialFileId] = useState<FileObjectId | null>(method.material?.file_id ?? null);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const qrIntentRef = useRef<UploadIntent | null>(null);
  const materialIntentRef = useRef<UploadIntent | null>(null);
  // After a save, the list item the parent receives has no signed links, so keep showing the file
  // that was just uploaded until the page is next loaded.
  const [savedQrPreview, setSavedQrPreview] = useState<SavedPreview | null>(null);
  const [savedMaterialPreview, setSavedMaterialPreview] = useState<SavedPreview | null>(null);

  const staffOnly = method.rail === "cash";
  const isQr = method.rail === "manual_qr";
  const mobileWallet = MOBILE_WALLETS.has(method.name.trim().toLowerCase());
  const busy = saveGuard.isSubmitting || removeGuard.isSubmitting || uploading;

  const markDirty = () => {
    saveGuard.resetIntent();
    setMessage(null);
  };

  async function upload(file: File, purpose: ImageUploadPurpose, intentRef: { current: UploadIntent | null }): Promise<FileObjectId> {
    setUploading(true);
    try {
      return await uploadStorefrontImage(file, getToken, intentRef, purpose);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (busy) return;
    setMessage(null);
    if (!staffOnly && mobileWallet && accountNumber && !/^09\d{9}$/.test(accountNumber)) {
      setMessage(`${method.name} numbers are 11 digits and start with 09.`);
      return;
    }
    if (presentation === "material" && !materialFileId && !materialFile) {
      setMessage("Upload your instructions file (PDF or image) to use this option.");
      return;
    }
    try {
      let nextQrFileId = qrFileId;
      if (isQr && presentation === "details" && qrFile) {
        nextQrFileId = await upload(qrFile, "storefront_asset", qrIntentRef);
        setQrFileId(nextQrFileId);
        setSavedQrPreview({ fileId: nextQrFileId, file: qrFile });
        setQrFile(null);
      }
      let nextMaterialFileId = materialFileId;
      if (presentation === "material" && materialFile) {
        nextMaterialFileId = await upload(materialFile, "payment_method_material", materialIntentRef);
        setMaterialFileId(nextMaterialFileId);
        setSavedMaterialPreview({ fileId: nextMaterialFileId, file: materialFile });
        setMaterialFile(null);
      }

      const result = await saveGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updatePaymentMethodSettings(
          method.id,
          {
            version: method.version,
            active,
            // On eligible plans, a new payment file also enables storefront availability.
            storefront_enabled: !staffOnly && !storefrontLocked && (storefrontEnabled || Boolean(qrFile) || Boolean(materialFile)),
            destination: {
              account_name: accountName.trim() || null,
              account_number: accountNumber.trim() || null,
              // Legacy per-method steps remain read-only until consolidated into the shared guide.
              instructions: method.destination.instructions,
            },
            qr_file_id: isQr ? nextQrFileId : null,
            presentation: staffOnly ? "details" : presentation,
            material_file_id: presentation === "material" ? nextMaterialFileId : null,
          },
          idempotencyKey,
        ),
      );
      if (!result) return;
      onSaved(result.data);
      setStorefrontEnabled(result.data.storefront_enabled);
      setQrFileId(result.data.qr_file_id);
      setMaterialFileId(result.data.material?.file_id ?? null);
      qrIntentRef.current = null;
      materialIntentRef.current = null;
      setMessage("Saved.");
    } catch (caught) {
      setMessage(errorMessage(caught, "Could not save this payment method."));
    }
  }

  async function remove() {
    if (busy) return;
    setMessage(null);
    try {
      const result = await removeGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).archivePaymentMethod(method.id, { version: method.version }, idempotencyKey),
      );
      if (!result) return;
      setConfirmRemove(false);
      onSaved(result.data);
    } catch (caught) {
      setMessage(errorMessage(caught, "Could not remove this payment method."));
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
              {isQr ? <QrCode className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-dashboard-navy">{method.name}</h3>
                <Badge variant="outline">{staffOnly ? "Staff only" : isQr ? "QR code" : "Account transfer"}</Badge>
              </div>
              <p className="mt-1 text-xs text-dashboard-muted">
                {staffOnly ? "Available only for staff-created reservations." : "Staff can use it right away; the storefront shows it once it is ready."}
              </p>
            </div>
          </div>
          {!staffOnly ? (
            <Badge variant="outline" className={method.storefront_ready ? "text-dashboard-green-text" : "text-dashboard-muted"}>
              {method.storefront_ready ? "Storefront ready" : "Storefront not ready"}
            </Badge>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ToggleRow
            checked={active}
            label="Accepted by staff"
            description="Show this method when Owner or Front Desk creates a reservation."
            onChange={(checked) => {
              setActive(checked);
              markDirty();
            }}
          />
          <ToggleRow
            checked={!staffOnly && storefrontEnabled}
            disabled={staffOnly}
            label="Available on storefront"
            description={staffOnly ? "Cash cannot secure an online storefront reservation." : storefrontLocked ? "Upgrade to enable renter-facing payment methods. This method remains available to staff." : "Shown to renters once the details or file are set."}
            onLocked={storefrontLocked ? () => requestUpgrade("storefront payment methods") : undefined}
            onChange={(checked) => {
              setStorefrontEnabled(checked);
              markDirty();
            }}
          />
        </div>

        {!staffOnly ? (
          <div className="mt-5 border-t border-dashboard-border pt-5">
            <PresentationChoice
              value={presentation}
              onChange={(next) => {
                setPresentation(next);
                markDirty();
              }}
            />

            {presentation === "details" ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Account name">
                    <Input value={accountName} maxLength={160} onChange={(event) => { setAccountName(event.target.value); markDirty(); }} />
                  </Field>
                  <Field label={mobileWallet ? `${method.name} number` : "Account number"}>
                    <Input
                      value={accountNumber}
                      type={mobileWallet ? "tel" : "text"}
                      inputMode={mobileWallet ? "numeric" : undefined}
                      maxLength={mobileWallet ? 11 : 120}
                      placeholder={mobileWallet ? "09XXXXXXXXX" : undefined}
                      onChange={(event) => {
                        setAccountNumber(mobileWallet ? event.target.value.replace(/\D/g, "").slice(0, 11) : event.target.value);
                        markDirty();
                      }}
                    />
                  </Field>
                </div>
                {isQr ? (
                  <FilePicker
                    id={`qr-${method.id}`}
                    label="QR image"
                    accept="image/jpeg,image/png,image/webp"
                    hint="PNG, JPG, or WebP up to 10 MB."
                    purpose="storefront_asset"
                    file={qrFile}
                    configured={Boolean(qrFileId)}
                    saved={savedFile(qrFileId, savedQrPreview, method.qr_image_url, "image/png")}
                    onPick={(file) => {
                      setQrFile(file);
                      qrIntentRef.current = null;
                      markDirty();
                    }}
                    onProblem={setMessage}
                  />
                ) : null}
              </>
            ) : (
              <FilePicker
                id={`material-${method.id}`}
                label="Your payment instructions"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                hint="PDF, PNG, JPG, or WebP up to 10 MB, with your QR code and steps."
                purpose="payment_method_material"
                file={materialFile}
                configured={Boolean(materialFileId)}
                saved={savedFile(materialFileId, savedMaterialPreview, method.material_url, method.material?.content_type ?? null)}
                configuredLabel={method.material?.content_type === "application/pdf" ? "PDF uploaded" : "Image uploaded"}
                onPick={(file) => {
                  setMaterialFile(file);
                  materialIntentRef.current = null;
                  markDirty();
                }}
                onProblem={setMessage}
              />
            )}

            {!method.storefront_ready ? (
              <p className="mt-3 text-xs text-dashboard-gold-text" role="status">
                {storefrontGap(method)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashboard-border pt-4">
          <p className="text-xs text-dashboard-muted" role={message && message !== "Saved." ? "alert" : undefined}>
            {message}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!staffOnly ? (
              confirmRemove ? (
                <>
                  <span className="text-xs text-dashboard-muted">Remove {method.name}?</span>
                  <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>
                    Keep
                  </Button>
                  <Button type="button" variant="danger" onClick={() => void remove()} disabled={busy}>
                    {removeGuard.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Remove
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remove
                </Button>
              )
            ) : null}
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {saveGuard.isSubmitting || uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {uploading ? "Uploading…" : saveGuard.isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RemovedMethodRow({ method, disabled, onRestored }: { method: PaymentMethodSettingsItem; disabled: boolean; onRestored: (saved: PaymentMethodSettingsItem) => void }) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [message, setMessage] = useState<string | null>(null);

  async function restore() {
    if (guard.isSubmitting) return;
    setMessage(null);
    try {
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updatePaymentMethodSettings(
          method.id,
          {
            version: method.version,
            active: true,
            storefront_enabled: false,
            destination: method.destination,
            qr_file_id: method.qr_file_id,
            presentation: method.presentation,
            material_file_id: method.material?.file_id ?? null,
          },
          idempotencyKey,
        ),
      );
      if (result) onRestored(result.data);
    } catch (caught) {
      setMessage(errorMessage(caught, "Could not restore this payment method."));
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashboard-border px-4 py-3">
      <span className="text-sm text-dashboard-navy">{method.name}</span>
      <span className="flex items-center gap-3">
        {message ? (
          <span role="alert" className="text-xs text-dashboard-danger">
            {message}
          </span>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => void restore()} disabled={disabled || guard.isSubmitting} title={disabled ? "Remove another method first" : undefined}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore
        </Button>
      </span>
    </li>
  );
}

type SavedPreview = { fileId: FileObjectId; file: File };
type SavedFile = { url: string | null; file: File | null; contentType: string | null };

/** What to show for the stored file: the one just uploaded here, else the server's signed link. */
function savedFile(
  fileId: FileObjectId | null,
  local: SavedPreview | null,
  url: string | null | undefined,
  contentType: string | null
): SavedFile | null {
  if (!fileId) return null;
  if (local?.fileId === fileId) return { url: null, file: local.file, contentType: local.file.type };
  return url ? { url, file: null, contentType } : null;
}

/** An object URL for a picked file, revoked when the file changes or the card unmounts. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function FilePreview({
  url,
  contentType,
  label,
  onOpenImage,
}: {
  url: string;
  contentType: string | null;
  label: string;
  onOpenImage: () => void;
}) {
  if (contentType === "application/pdf") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-dashboard-accent hover:underline">
        <FileText className="h-4 w-4" aria-hidden="true" /> View PDF
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpenImage}
      aria-label={`Open ${label} preview`}
      className="group relative mb-2 block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- API-proxied media route or local upload preview */}
      <img src={url} srcSet={mediaImageSrcSet(url)} sizes="(min-width: 640px) 48rem, 100vw" alt={label} className="block max-h-48 max-w-full w-auto object-contain" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1 pb-1.5 pt-5 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        Click to enlarge
      </span>
    </button>
  );
}

function FilePicker({
  id,
  label,
  accept,
  hint,
  purpose,
  file,
  configured,
  configuredLabel = "Configured",
  saved = null,
  onPick,
  onProblem,
}: {
  id: string;
  label: string;
  accept: string;
  hint: string;
  purpose: ImageUploadPurpose;
  file: File | null;
  configured: boolean;
  configuredLabel?: string;
  saved?: SavedFile | null;
  onPick: (file: File | null) => void;
  onProblem: (message: string) => void;
}) {
  const Icon = file ? (file.type === "application/pdf" ? FileText : ImageIcon) : UploadCloud;
  const pickedUrl = useObjectUrl(file);
  const savedLocalUrl = useObjectUrl(saved?.file ?? null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const previewName = label.startsWith("Your ") ? label.slice("Your ".length) : label;
  const preview = file
    ? pickedUrl && { url: pickedUrl, contentType: file.type, label: `New ${previewName}: ${file.name}` }
    : saved && (saved.url ?? savedLocalUrl) && { url: (saved.url ?? savedLocalUrl) as string, contentType: saved.contentType, label: `Current ${previewName}` };
  const isImagePreview = Boolean(preview && preview.contentType !== "application/pdf");
  return (
    <div className="relative mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-dashboard-navy" htmlFor={id}>
          {label}
        </label>
        {configured && !file ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-dashboard-green-text">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {configuredLabel}
          </span>
        ) : null}
      </div>
      {preview ? (
        <FilePreview
          url={preview.url}
          contentType={preview.contentType}
          label={preview.label}
          onOpenImage={() => setLightboxOpen(true)}
        />
      ) : null}
      <input
        id={id}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          const problem = picked ? storefrontImageProblem(picked, purpose) : null;
          if (problem) {
            onProblem(problem);
            event.target.value = "";
            return;
          }
          onPick(picked);
        }}
      />
      <label
        htmlFor={id}
        className="group flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-dashboard-border bg-dashboard-canvas/60 px-4 py-4 transition-colors hover:border-dashboard-accent/60 hover:bg-dashboard-active/40 focus-within:border-dashboard-accent"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-dashboard-navy">{file ? file.name : configured ? "Replace file" : "Choose a file"}</span>
          <span className="mt-1 block text-xs leading-5 text-dashboard-muted">{file ? "Uploads when you save." : hint}</span>
        </span>
        <span className="shrink-0 rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-1.5 text-xs font-medium text-dashboard-navy">
          {configured ? "Change" : "Browse"}
        </span>
      </label>
      <ImageLightbox
        images={preview && isImagePreview ? [{ src: preview.url, alt: `${preview.label} full-size preview` }] : []}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        activeIndex={0}
        onActiveIndexChange={() => undefined}
      />
    </div>
  );
}

function ToggleRow({
  checked,
  disabled = false,
  label,
  description,
  onLocked,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onLocked?: (() => void) | undefined;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-dashboard-border p-3">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(event) => (onLocked ? onLocked() : onChange(event.target.checked))} />
      <span>
        <span className="block text-sm font-medium text-dashboard-navy">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-dashboard-muted">{description}</span>
      </span>
    </label>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={className}>
      <span className="text-sm font-medium text-dashboard-navy">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) {
    if (error.code === "PAYMENT_METHOD_LIMIT") return `You can use up to ${MAX_ONLINE_PAYMENT_METHODS} online payment methods. Remove one first.`;
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Why a saved online method is not shown to renters, in the owner's words. Mirrors the server's
 * readiness rule (payment-method-readiness.ts); the server stays the authority.
 */
export function storefrontGap(method: PaymentMethodSettingsItem): string {
  if (!method.active) return "Turn on \"Accepted by staff\" and save to show this method to renters.";
  if (!method.storefront_enabled) return "Turn on \"Available on storefront\" and save to show this method to renters.";
  if (method.presentation === "material") {
    return method.material ? "Your instructions file did not finish uploading. Upload it again and save." : "Upload your instructions file and save.";
  }
  if (method.rail === "manual_qr") {
    return method.qr_file_id ? "Your QR image did not finish uploading. Upload it again and save." : "Upload your QR image and save.";
  }
  return "Add the account number and save.";
}
