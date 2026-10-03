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
} from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { storefrontImageProblem, uploadStorefrontImage, type ImageUploadPurpose, type UploadIntent } from "@/lib/storefront-assets";
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
  const [methods, setMethods] = useState<PaymentMethodSettingsItem[]>([]);
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
        if (!cancelled) setMethods(result.data.items);
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
            How renters pay you. Add up to {MAX_ONLINE_PAYMENT_METHODS} online methods (e-wallets or banks). For each one, type the details or upload the
            instructions you already use, as a PDF or an image with your QR code.
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

      {adding ? <AddPaymentMethodCard onCancel={() => setAdding(false)} onCreated={(created) => { upsert(created); setAdding(false); }} /> : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-dashboard-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading payment methods…
        </div>
      ) : (
        <div className="grid gap-4">
          {ordered.map((method) => (
            <PaymentMethodEditor key={method.id} method={method} onSaved={upsert} />
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
    </div>
  );
}

function AddPaymentMethodCard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (created: PaymentMethodSettingsItem) => void }) {
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
            // Online methods are meant for renters; the storefront still hides one until it is ready.
            storefront_enabled: true,
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
    <Card className="mb-4 gap-0 border-dashboard-accent/40 py-0">
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
    { value: "details", label: "Type the details", description: "Account name, number, steps, and an optional QR image." },
    { value: "material", label: "Upload my instructions", description: "A PDF or image you already share, with your QR and steps." },
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

function PaymentMethodEditor({ method, onSaved }: { method: PaymentMethodSettingsItem; onSaved: (saved: PaymentMethodSettingsItem) => void }) {
  const { getToken } = useAuth();
  const saveGuard = useSubmitGuard();
  const removeGuard = useSubmitGuard();
  const [active, setActive] = useState(method.active);
  const [storefrontEnabled, setStorefrontEnabled] = useState(method.storefront_enabled);
  const [accountName, setAccountName] = useState(method.destination.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(method.destination.account_number ?? "");
  const [instructions, setInstructions] = useState(method.destination.instructions ?? "");
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
        setQrFile(null);
      }
      let nextMaterialFileId = materialFileId;
      if (presentation === "material" && materialFile) {
        nextMaterialFileId = await upload(materialFile, "payment_method_material", materialIntentRef);
        setMaterialFileId(nextMaterialFileId);
        setMaterialFile(null);
      }

      const result = await saveGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updatePaymentMethodSettings(
          method.id,
          {
            version: method.version,
            active,
            // Uploading a QR or instructions file is the owner asking renters to pay with it.
            storefront_enabled: staffOnly ? false : storefrontEnabled || Boolean(qrFile) || Boolean(materialFile),
            destination: {
              account_name: accountName.trim() || null,
              account_number: accountNumber.trim() || null,
              instructions: instructions.trim() || null,
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
            description={staffOnly ? "Cash cannot secure an online storefront reservation." : "Shown to renters once the details or file are set."}
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
                <Field label="Steps for renters" className="mt-3 block">
                  <Input value={instructions} maxLength={500} onChange={(event) => { setInstructions(event.target.value); markDirty(); }} />
                </Field>
                {isQr ? (
                  <FilePicker
                    id={`qr-${method.id}`}
                    label="QR image"
                    accept="image/jpeg,image/png,image/webp"
                    hint="PNG, JPG, or WebP up to 10 MB."
                    purpose="storefront_asset"
                    file={qrFile}
                    configured={Boolean(qrFileId)}
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

function FilePicker({
  id,
  label,
  accept,
  hint,
  purpose,
  file,
  configured,
  configuredLabel = "Configured",
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
  onPick: (file: File | null) => void;
  onProblem: (message: string) => void;
}) {
  const Icon = file ? (file.type === "application/pdf" ? FileText : ImageIcon) : UploadCloud;
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
    </div>
  );
}

function ToggleRow({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-dashboard-border p-3">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
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
