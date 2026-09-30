"use client";

import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, CreditCard, ImageIcon, Loader2, QrCode, Save, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FileObjectId, PaymentMethodSettingsItem } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { uploadStorefrontImage, type UploadIntent } from "@/lib/storefront-assets";
import { useSubmitGuard } from "@/lib/use-submit-guard";

export function PaymentMethodSettingsPage() {
  const { getToken } = useAuth();
  const [methods, setMethods] = useState<PaymentMethodSettingsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="w-full">
        <div className="mb-5">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-dashboard-navy">Payment methods</h2>
          <p className="mt-1 max-w-2xl text-sm text-dashboard-muted">
            Choose what staff can use for reservations and which configured online methods may appear on the public storefront.
          </p>
        </div>

        {error ? (
          <div role="alert" className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-dashboard-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payment methods…
          </div>
        ) : (
          <div className="grid gap-4">
            {methods.map((method) => (
              <PaymentMethodEditor
                key={method.id}
                method={method}
                onSaved={(saved) =>
                  setMethods((current) => current.map((item) => (item.id === saved.id ? saved : item)))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentMethodEditor({
  method,
  onSaved,
}: {
  method: PaymentMethodSettingsItem;
  onSaved: (saved: PaymentMethodSettingsItem) => void;
}) {
  const { getToken } = useAuth();
  const saveGuard = useSubmitGuard();
  const [active, setActive] = useState(method.active);
  const [storefrontEnabled, setStorefrontEnabled] = useState(method.storefront_enabled);
  const [accountName, setAccountName] = useState(method.destination.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(method.destination.account_number ?? "");
  const [instructions, setInstructions] = useState(method.destination.instructions ?? "");
  const [qrFileId, setQrFileId] = useState<FileObjectId | null>(method.qr_file_id);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadIntentRef = useRef<UploadIntent | null>(null);

  const staffOnly = method.rail === "cash";
  const isQr = method.rail === "manual_qr";
  const isGcash = method.name.trim().toLowerCase() === "gcash";

  const markDirty = () => {
    saveGuard.resetIntent();
    setMessage(null);
  };

  async function save() {
    if (saveGuard.isSubmitting || uploading) return;
    setMessage(null);
    if (isGcash && accountNumber && !/^\d{11}$/.test(accountNumber)) {
      setMessage("GCash number must be exactly 11 digits.");
      return;
    }
    try {
      let nextQrFileId = qrFileId;
      if (isQr && qrFile) {
        setUploading(true);
        nextQrFileId = await uploadStorefrontImage(qrFile, getToken, uploadIntentRef);
        setQrFileId(nextQrFileId);
        setQrFile(null);
        setUploading(false);
      }

      const result = await saveGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updatePaymentMethodSettings(
          method.id,
          {
            version: method.version,
            active,
            storefront_enabled: staffOnly ? false : storefrontEnabled,
            destination: {
              account_name: accountName.trim() || null,
              account_number: accountNumber.trim() || null,
              instructions: instructions.trim() || null,
            },
            qr_file_id: isQr ? nextQrFileId : null,
          },
          idempotencyKey
        )
      );
      if (!result) return;
      onSaved(result.data);
      setStorefrontEnabled(result.data.storefront_enabled);
      setQrFileId(result.data.qr_file_id);
      uploadIntentRef.current = null;
      saveGuard.resetIntent();
      setMessage("Saved.");
    } catch (caught) {
      setUploading(false);
      setMessage(errorMessage(caught, "Could not save this payment method."));
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
                <h2 className="text-base font-semibold text-dashboard-navy">{method.name}</h2>
                <Badge variant="outline">{method.rail.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-xs text-dashboard-muted">
                {staffOnly
                  ? "Available only for staff-created reservations."
                  : "Can be used internally even before public payment instructions are configured."}
              </p>
            </div>
          </div>
          {!staffOnly ? (
            <Badge variant="outline" className={method.storefront_ready ? "text-emerald-600" : "text-dashboard-muted"}>
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
            description={staffOnly ? "Cash cannot secure an online storefront reservation." : "Public only when the method is also configured and ready."}
            onChange={(checked) => {
              setStorefrontEnabled(checked);
              markDirty();
            }}
          />
        </div>

        {!staffOnly ? (
          <div className="mt-5 border-t border-dashboard-border pt-5">
            <p className="text-sm font-semibold text-dashboard-navy">Online payment details</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Account name">
                <Input value={accountName} onChange={(event) => { setAccountName(event.target.value); markDirty(); }} />
              </Field>
              <Field label={isGcash ? "GCash number" : "Account number"}>
                <Input
                  value={accountNumber}
                  aria-label={isGcash ? "GCash number" : "Account number"}
                  type={isGcash ? "tel" : "text"}
                  inputMode={isGcash ? "numeric" : undefined}
                  maxLength={isGcash ? 11 : undefined}
                  pattern={isGcash ? "[0-9]{11}" : undefined}
                  placeholder={isGcash ? "09XXXXXXXXX" : undefined}
                  onChange={(event) => {
                    const value = isGcash
                      ? event.target.value.replace(/\D/g, "").slice(0, 11)
                      : event.target.value;
                    setAccountNumber(value);
                    markDirty();
                  }}
                />
                {isGcash ? (
                  <span className="mt-1 block text-xs text-dashboard-muted">11-digit Philippine mobile number</span>
                ) : null}
              </Field>
            </div>
            <Field label="Customer instructions" className="mt-3">
              <Input value={instructions} onChange={(event) => { setInstructions(event.target.value); markDirty(); }} />
            </Field>

            {isQr ? (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-dashboard-navy" htmlFor={`qr-${method.id}`}>
                    QR image
                  </label>
                  {qrFileId && !qrFile ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Configured
                    </span>
                  ) : null}
                </div>

                <input
                  id={`qr-${method.id}`}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 10 * 1024 * 1024) {
                      setMessage("QR images must be 10 MB or smaller.");
                      event.target.value = "";
                      return;
                    }
                    setQrFile(file);
                    uploadIntentRef.current = null;
                    markDirty();
                  }}
                />

                <label
                  htmlFor={`qr-${method.id}`}
                  className="group flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-dashboard-border bg-dashboard-canvas/60 px-4 py-4 transition-colors hover:border-dashboard-accent/60 hover:bg-dashboard-active/40 focus-within:border-dashboard-accent"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent transition-transform group-hover:scale-[1.03]">
                    {qrFile ? (
                      <ImageIcon className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <UploadCloud className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-dashboard-navy">
                      {qrFile
                        ? qrFile.name
                        : qrFileId
                          ? "Replace QR image"
                          : "Upload QR image"}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-dashboard-muted">
                      {qrFile
                        ? "Selected and ready to upload when you save."
                        : "PNG, JPG, or WebP up to 10 MB."}
                    </span>
                  </span>

                  <span className="shrink-0 rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-1.5 text-xs font-medium text-dashboard-navy transition-colors group-hover:border-dashboard-accent/40">
                    {qrFileId ? "Change" : "Choose file"}
                  </span>
                </label>
              </div>
            ) : null}

            {storefrontEnabled && !method.storefront_ready ? (
              <p className="mt-3 text-xs text-amber-600">
                This method stays hidden from the public storefront until its required online-payment configuration is complete.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-dashboard-border pt-4">
          <p className="text-xs text-dashboard-muted" role={message && message !== "Saved." ? "alert" : undefined}>{message}</p>
          <Button type="button" onClick={() => void save()} disabled={saveGuard.isSubmitting || uploading}>
            {saveGuard.isSubmitting || uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {uploading ? "Uploading…" : saveGuard.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
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
  if (error instanceof DrezivoApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
