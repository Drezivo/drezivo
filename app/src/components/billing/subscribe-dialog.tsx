"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, Clock, FileText, ImageIcon, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BillingOverview, FileObjectId, PlatformPaymentMethod, SubscriptionPaymentView } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { storefrontImageProblem, uploadStorefrontImage, type UploadIntent } from "@/lib/storefront-assets";
import { useSubmitGuard } from "@/lib/use-submit-guard";

const peso = (minor: string) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: Number(minor) % 100 === 0 ? 0 : 2 }).format(Number(minor) / 100);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; billing: BillingOverview };

/**
 * Pay Drezivo for one month of Standard: pick one of Drezivo's payment methods, pay by QR or
 * transfer, then send the reference number and a screenshot or PDF of the receipt. An operator
 * checks it; full access returns on approval. One payment can wait for review at a time.
 */
export function SubscribeDialog({ open, onOpenChange, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmitted: () => void }) {
  const { getToken } = useAuth();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    createDrezivoApiClient(getToken)
      .getBilling()
      .then((result) => {
        if (!cancelled) setLoad({ kind: "ready", billing: result.data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: error instanceof DrezivoApiError ? error.message : "Could not load your subscription." });
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, open, reloadKey]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92svh] overflow-y-auto rounded-t-2xl border border-dashboard-border bg-dashboard-surface p-5 text-dashboard-navy shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl">Subscribe to Drezivo</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-dashboard-muted">Standard plan: ₱300 a month, up to 125 garments, for the shop owner only.</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {load.kind === "loading" ? (
            <p className="flex items-center gap-2 py-10 text-sm text-dashboard-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : load.kind === "error" ? (
            <div className="py-8">
              <p role="alert" className="text-sm text-red-500">
                {load.message}
              </p>
              <Button type="button" variant="secondary" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>
                Try again
              </Button>
            </div>
          ) : (
            <SubscribeBody
              billing={load.billing}
              onSubmitted={() => {
                onSubmitted();
                setReloadKey((value) => value + 1);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SubscribeBody({ billing, onSubmitted }: { billing: BillingOverview; onSubmitted: () => void }) {
  const pending = billing.payments.find((payment) => payment.status === "pending") ?? null;
  const lastRejected = !pending ? (billing.payments.find((payment) => payment.status !== "pending") ?? null) : null;

  return (
    <div className="mt-6 grid gap-6">
      {pending ? (
        <StatusNote tone="waiting" title="Payment submitted, waiting for approval">
          Reference {pending.reference} via {pending.payment_method_label}, sent {shortDate(pending.submitted_at)}. Drezivo checks it against the transfer and
          confirms by email.
        </StatusNote>
      ) : lastRejected?.status === "failed" ? (
        <StatusNote tone="rejected" title="Your last payment was not approved">
          {lastRejected.review_note ?? "It could not be matched to a transfer."} You can send it again below.
        </StatusNote>
      ) : null}

      {!pending ? (
        billing.can_pay ? (
          billing.payment_methods.length > 0 ? (
            <PaymentForm billing={billing} onSubmitted={onSubmitted} />
          ) : (
            <p className="text-sm text-dashboard-muted">Payment options are being set up. Contact Drezivo support to subscribe.</p>
          )
        ) : (
          <p className="text-sm text-dashboard-muted">Only the business owner can subscribe. Ask them to open this from their account.</p>
        )
      ) : null}

      {billing.payments.length > 0 ? <History payments={billing.payments} /> : null}
    </div>
  );
}

function PaymentForm({ billing, onSubmitted }: { billing: BillingOverview; onSubmitted: () => void }) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [methodId, setMethodId] = useState(billing.payment_methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const uploadedRef = useRef<{ file: File; id: FileObjectId } | null>(null);
  const method = billing.payment_methods.find((item) => item.id === methodId) ?? null;
  const busy = guard.isSubmitting || uploading;

  const edited = () => {
    guard.resetIntent();
    setMessage(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!method) return setMessage("Choose how you paid.");
    if (!reference.trim()) return setMessage("Enter the reference number from your receipt.");
    if (!proof) return setMessage("Attach a screenshot or PDF of your receipt.");
    setMessage(null);
    try {
      let proofId = uploadedRef.current?.file === proof ? uploadedRef.current.id : null;
      if (!proofId) {
        setUploading(true);
        try {
          proofId = await uploadStorefrontImage(proof, getToken, intentRef, "subscription_payment_proof");
        } finally {
          setUploading(false);
        }
        uploadedRef.current = { file: proof, id: proofId };
      }
      const fileId = proofId;
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).submitSubscriptionPayment(
          { payment_method_id: method.id, reference: reference.trim(), proof_file_id: fileId },
          idempotencyKey,
        ),
      );
      if (result) onSubmitted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send your payment. Try again.");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5">
      <fieldset>
        <legend className="text-sm font-semibold">1. Pay {peso(billing.plan.monthly_minor)}</legend>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
          {billing.payment_methods.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === methodId}
              onClick={() => {
                setMethodId(option.id);
                edited();
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${option.id === methodId ? "border-dashboard-accent bg-dashboard-active text-dashboard-navy" : "border-dashboard-border text-dashboard-muted hover:text-dashboard-navy"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {method ? <MethodDetails method={method} amount={peso(billing.plan.monthly_minor)} /> : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold">2. Send your receipt</legend>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Reference number</span>
          <Input
            value={reference}
            maxLength={64}
            autoComplete="off"
            placeholder="e.g. 1003 456 789012"
            onChange={(event) => {
              setReference(event.target.value);
              edited();
            }}
          />
        </label>
        <div className="relative">
          <input
            id="subscription-proof"
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              const problem = file ? storefrontImageProblem(file, "subscription_payment_proof") : null;
              if (problem) {
                setMessage(problem);
                event.target.value = "";
                return;
              }
              setProof(file);
              intentRef.current = null;
              edited();
            }}
          />
          <label
            htmlFor="subscription-proof"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-dashboard-border px-4 py-3 hover:border-dashboard-accent/60 focus-within:border-dashboard-accent"
          >
            {proof ? proof.type === "application/pdf" ? <FileText className="h-5 w-5 text-dashboard-accent" /> : <ImageIcon className="h-5 w-5 text-dashboard-accent" /> : <UploadCloud className="h-5 w-5 text-dashboard-accent" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{proof ? proof.name : "Attach receipt"}</span>
              <span className="block text-xs text-dashboard-muted">Screenshot or PDF, up to 10 MB</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashboard-border pt-4">
        <p className="text-xs text-dashboard-muted" role={message ? "alert" : undefined}>
          {message ?? "Full access returns as soon as Drezivo approves your payment."}
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {uploading ? "Uploading…" : guard.isSubmitting ? "Sending…" : "Send payment"}
        </Button>
      </div>
    </form>
  );
}

function MethodDetails({ method, amount }: { method: PlatformPaymentMethod; amount: string }) {
  const { getToken } = useAuth();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    if (!method.has_qr) return;
    let revoked = false;
    let url: string | null = null;
    setQrUrl(null);
    setQrFailed(false);
    createDrezivoApiClient(getToken)
      .getBillingQrObjectUrl(method.id)
      .then((objectUrl) => {
        url = objectUrl;
        if (revoked) URL.revokeObjectURL(objectUrl);
        else setQrUrl(objectUrl);
      })
      .catch(() => setQrFailed(true));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [getToken, method.has_qr, method.id]);

  return (
    <div className="mt-3 grid gap-4 rounded-xl border border-dashboard-border p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      {method.has_qr ? (
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- authorized object URL
            <img src={qrUrl} alt={`${method.label} QR code`} className="h-full w-full object-contain" />
          ) : qrFailed ? (
            <span className="p-3 text-center text-xs text-neutral-600">QR could not load. Use the account details.</span>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          )}
        </div>
      ) : null}
      <dl className="grid content-start gap-2 text-sm">
        <div>
          <dt className="text-xs text-dashboard-muted">Amount</dt>
          <dd className="font-semibold">{amount}</dd>
        </div>
        {method.account_name ? (
          <div>
            <dt className="text-xs text-dashboard-muted">Account name</dt>
            <dd className="break-words">{method.account_name}</dd>
          </div>
        ) : null}
        {method.account_number ? (
          <div>
            <dt className="text-xs text-dashboard-muted">Account number</dt>
            <dd className="break-all font-mono">{method.account_number}</dd>
          </div>
        ) : null}
        {method.instructions ? <dd className="whitespace-pre-line text-dashboard-muted">{method.instructions}</dd> : null}
        <dd className="text-xs text-dashboard-muted">Always check the account name matches before paying.</dd>
      </dl>
    </div>
  );
}

function StatusNote({ tone, title, children }: { tone: "waiting" | "rejected"; title: string; children: React.ReactNode }) {
  const Icon = tone === "waiting" ? Clock : XCircle;
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${tone === "waiting" ? "border-amber-400/40 bg-amber-500/10" : "border-red-400/40 bg-red-500/10"}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm text-dashboard-muted">{children}</p>
      </div>
    </div>
  );
}

function History({ payments }: { payments: SubscriptionPaymentView[] }) {
  const label = { pending: "Waiting for approval", verified: "Approved", failed: "Not approved" } as const;
  return (
    <section aria-labelledby="payment-history">
      <h3 id="payment-history" className="text-sm font-semibold">
        Payment history
      </h3>
      <ul className="mt-2 divide-y divide-dashboard-border rounded-xl border border-dashboard-border text-sm">
        {payments.map((payment) => (
          <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="min-w-0">
              {shortDate(payment.submitted_at)} · {payment.payment_method_label} · Ref {payment.reference}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${payment.status === "verified" ? "text-dashboard-green-text" : payment.status === "failed" ? "text-red-500" : "text-amber-500"}`}>
              {payment.status === "verified" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              {label[payment.status]} · {peso(payment.amount_minor)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
