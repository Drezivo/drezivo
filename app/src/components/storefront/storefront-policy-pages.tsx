"use client";

import { CalendarCheck, CalendarClock, ClipboardList, Info, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { FieldRequirement, StorefrontCheckout, StorefrontPolicyRules } from "@drezivo/contracts";

import { ErrorState, Field, LoadingState, PageHeader, SaveBar, Section, Switch } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { useRequestPlanUpgrade } from "@/components/billing/plan-upgrade-dialog";

import { PolicyImagesField } from "./policy-images-field";
import { PageShell } from "./storefront-details-page";
import { useDocumentDraft, useStorefrontEditor } from "./storefront-editor";

const EMPTY_RULES: StorefrontPolicyRules = {
  format: "text",
  rental: "",
  deposit: "",
  cancellation: "",
  damage: null,
  image_file_ids: [],
  delivery: { enabled: false, fee_minor: "0", notes: null },
  privacy_notice: "",
};

/** Pesos typed by the owner → integer centavos for the API. Empty means zero. */
export function pesosToMinor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "0";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return String(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

export function minorToPesos(minor: string): string {
  const value = Number(minor);
  return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
}

/** Editable starter wording for a new storefront's privacy notice. Publishing remains explicit. */
const EXAMPLE_TEXT = {
  rental: "Rentals run 3 days from pickup. Pick up from 10 AM and return by 10 AM on your return date.",
  deposit: "A refundable deposit is paid with your booking and returned within 3 days after inspection.",
  cancellation: "Cancel at least 7 days before pickup for a full refund of the rental fee.",
  damage: "Late returns are charged one extra day per day late. Damage beyond normal wear is charged at the cost of repair.",
} as const;

function exampleText(storeName: string) {
  return {
    ...EXAMPLE_TEXT,
    privacy_notice: `${storeName} uses the information you provide, such as your name, email, phone number, rental or fitting details, and, for reservations, your pickup or delivery address, to manage your request, arrange pickup or delivery, and contact you. Depending on your request, this may also include the selected item and dates, event date, social-media handle, fitting note, and any payment proof you submit. Drezivo processes this information for the shop to provide the booking service. Contact the shop through its storefront details with privacy questions.`,
  };
}

function rulesWithPrivacyStarter(saved: StorefrontPolicyRules | null, examples: ReturnType<typeof exampleText>): StorefrontPolicyRules {
  const rules = saved ?? EMPTY_RULES;
  return rules.privacy_notice.trim() ? rules : { ...rules, privacy_notice: examples.privacy_notice };
}

export function StorefrontPoliciesPage() {
  const editor = useStorefrontEditor();
  const saved = editor.settings?.policy.rules ?? null;
  const version = editor.settings?.policy.version;
  const examples = exampleText(editor.settings?.document.branding.display_name ?? "Your rental business");
  const [rules, setRules] = useState<StorefrontPolicyRules>(() => rulesWithPrivacyStarter(saved, examples));
  const [uploadingImages, setUploadingImages] = useState(false);

  useEffect(() => {
    setRules(rulesWithPrivacyStarter(saved, examples));
    // Reset only when a new policy version arrives from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (!editor.settings) {
    return <PageShell>{editor.loadError ? <ErrorState message={editor.loadError} onRetry={editor.reload} /> : <LoadingState label="Loading…" />}</PageShell>;
  }
  const update = (patch: Partial<StorefrontPolicyRules>) => {
    setRules((current) => ({ ...current, ...patch }));
    editor.markEdited();
  };
  const err = (path: string) => editor.fieldErrors[`policy.${path}`] ?? null;
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved ?? EMPTY_RULES);
  const text = (key: "rental" | "deposit" | "cancellation" | "privacy_notice", label: string, hint: string, max: number) => (
    <Field label={label} hint={hint} error={err(key)} count={{ value: rules[key].length, max }}>
      {(props) => <Textarea {...props} rows={4} maxLength={max} placeholder={key === "privacy_notice" ? undefined : examples[key]} value={rules[key]} onChange={(e) => update({ [key]: e.target.value })} />}
    </Field>
  );
  const blank = !saved && !rules.rental && !rules.deposit && !rules.cancellation && !rules.damage &&
    (!rules.privacy_notice || rules.privacy_notice === examples.privacy_notice);
  const imageTerms = rules.format === "images";

  return (
    <PageShell>
      <PageHeader
        title="Rental policies"
        description="Renters accept these before they pay. Each save publishes a new version; existing bookings keep the version they accepted."
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 text-sm text-dashboard-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1">
          {saved ? `You are editing version ${editor.settings.policy.version}.` : "You have not written a policy yet. Your storefront cannot go live without one."}
        </span>
        {blank && !imageTerms ? (
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => update({ ...examples })}>
            Start from example text
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4">
        <Section icon={ShieldCheck} title="Rental terms">
          <div
            className="mb-4 flex rounded-lg border border-dashboard-border bg-dashboard-surface p-1"
            role="group"
            aria-label="How to show your rental terms"
          >
            {([["text", "Type it"], ["images", "Upload images"]] as const).map(([format, label]) => (
              <button
                key={format}
                type="button"
                aria-pressed={rules.format === format}
                onClick={() => update({ format })}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  rules.format === format ? "bg-dashboard-active text-dashboard-accent" : "text-dashboard-muted hover:text-dashboard-navy"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {imageTerms ? (
            <div className="grid gap-3">
              <p className="text-sm text-dashboard-muted">
                Already have your policy as a picture or a printed page? Upload it here. Renters see each page at full width on your
                Rental info page and accept it before they book. Use clear, straight photos so every line is readable.
              </p>
              <PolicyImagesField
                fileIds={rules.image_file_ids}
                savedUrls={editor.settings.policy.image_urls}
                error={err("image_file_ids")}
                onChange={(image_file_ids) => update({ image_file_ids })}
                onUploadingChange={setUploadingImages}
              />
            </div>
          ) : (
            <div className="grid gap-4">
              {text("rental", "How renting works", "Rental length, pickup and return, and what is included.", 1500)}
              {text("deposit", "Security deposit", "How much, when it is paid, and when it is returned.", 1000)}
              {text("cancellation", "Cancellation", "What happens if a renter cancels.", 1500)}
              <Field label="Damage and late returns" hint="Optional." error={err("damage")} count={{ value: rules.damage?.length ?? 0, max: 1000 }}>
                {(props) => <Textarea {...props} rows={3} maxLength={1000} placeholder={EXAMPLE_TEXT.damage} value={rules.damage ?? ""} onChange={(e) => update({ damage: e.target.value.trim() ? e.target.value : null })} />}
              </Field>
            </div>
          )}
        </Section>

        <Section icon={ShieldCheck} title="Privacy notice" description="How you use renter details. Shown at checkout.">
          {text("privacy_notice", "Privacy notice", "Keep it plain and specific.", 2000)}
        </Section>
      </div>

      <SaveBar
        dirty={dirty}
        saving={editor.saving}
        state={editor.saveState}
        label={saved ? "Publish new version" : "Publish policy"}
        blockedReason={uploadingImages ? "Wait for the pages to finish uploading." : null}
        onSave={() => {
          if (uploadingImages) return;
          void editor.savePolicy(rules);
        }}
      />
    </PageShell>
  );
}

const REQUIREMENT_OPTIONS: Array<{ value: FieldRequirement; label: string }> = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "hidden", label: "Don't ask" },
];

function RequirementRow({ label, description, value, onChange, onLocked }: { label: string; description: string; value: FieldRequirement; onChange: (value: FieldRequirement) => void; onLocked?: (() => void) | undefined }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-dashboard-navy">{label}</p>
        <p className="mt-0.5 text-xs text-dashboard-muted">{description}</p>
      </div>
      <div role="radiogroup" aria-label={label} aria-disabled={onLocked ? true : undefined} className={cn("inline-flex shrink-0 rounded-lg border border-dashboard-border p-0.5", onLocked && "opacity-70")}>
        {REQUIREMENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            aria-disabled={onLocked ? true : undefined}
            title={onLocked ? "Upgrade to customize renter checkout details" : undefined}
            onClick={onLocked ?? (() => onChange(option.value))}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40",
              value === option.value ? "bg-dashboard-primary text-dashboard-primary-ink" : "text-dashboard-muted hover:text-dashboard-navy",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function useCheckoutDraft() {
  const editor = useStorefrontEditor();
  const checkout = useDocumentDraft("checkout");
  const save = (draft: StorefrontCheckout) => {
    if (!editor.settings) return Promise.resolve(false);
    return editor.saveDocument({ ...editor.settings.document, checkout: draft });
  };
  return { editor, checkout, save };
}

export function StorefrontRequirementsPage() {
  const { editor, checkout, save } = useCheckoutDraft();
  const actor = useVerifiedActorContext();
  const requestUpgrade = useRequestPlanUpgrade();
  const requirementsLocked = actor?.entitlements.features.storefront_reservations === false;
  if (!editor.settings || !checkout.draft) {
    return <PageShell>{editor.loadError ? <ErrorState message={editor.loadError} onRetry={editor.reload} /> : <LoadingState label="Loading…" />}</PageShell>;
  }
  const draft = checkout.draft;
  const set = (key: keyof StorefrontCheckout["requirements"]) => (value: FieldRequirement) => checkout.update({ requirements: { ...draft.requirements, [key]: value } });

  return (
    <PageShell>
      <PageHeader
        title="Customer requirements"
        description={requirementsLocked ? "Free storefronts show availability and shop contact only. Upgrade to customize renter checkout details." : "Ask only for what you need. Every renter always gives a full name, a verified email, and an address."}
      />
      <Section icon={ClipboardList} title="Checkout details">
        <div className="divide-y divide-dashboard-border">
          <RequirementRow label="Mobile number" description="For pickup and delivery coordination." value={draft.requirements.phone} onChange={set("phone")} onLocked={requirementsLocked ? () => requestUpgrade("customer requirements") : undefined} />
          <RequirementRow label="Social media handle" description="Instagram or Facebook, if you confirm renters there." value={draft.requirements.social_handle} onChange={set("social_handle")} onLocked={requirementsLocked ? () => requestUpgrade("customer requirements") : undefined} />
          <RequirementRow label="Event date" description="The date the renter will wear the piece." value={draft.requirements.event_date} onChange={set("event_date")} onLocked={requirementsLocked ? () => requestUpgrade("customer requirements") : undefined} />
        </div>
      </Section>
      <SaveBar
        dirty={checkout.dirty}
        saving={editor.saving}
        state={editor.saveState}
        blockedReason={requirementsLocked ? "Upgrade to change customer requirements." : null}
        onSave={() => save(draft)}
      />
    </PageShell>
  );
}

export function StorefrontBookingSettingsPage() {
  const { editor, checkout, save } = useCheckoutDraft();
  const actor = useVerifiedActorContext();
  const requestUpgrade = useRequestPlanUpgrade();
  const reservationsLocked = actor?.entitlements.features.storefront_reservations === false;
  const fittingsLocked = actor?.entitlements.features.fittings === false;
  const savedPolicy = editor.settings?.policy.rules ?? null;
  const policyVersion = editor.settings?.policy.version;
  const [delivery, setDelivery] = useState(() => savedPolicy?.delivery ?? EMPTY_RULES.delivery);
  const [fee, setFee] = useState(() => minorToPesos(savedPolicy?.delivery.fee_minor ?? "0"));
  useEffect(() => {
    setDelivery(savedPolicy?.delivery ?? EMPTY_RULES.delivery);
    setFee(minorToPesos(savedPolicy?.delivery.fee_minor ?? "0"));
    // Reset delivery edits only when the saved policy version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyVersion]);
  if (!editor.settings || !checkout.draft) {
    return <PageShell>{editor.loadError ? <ErrorState message={editor.loadError} onRetry={editor.reload} /> : <LoadingState label="Loading…" />}</PageShell>;
  }
  const draft = checkout.draft;
  const err = (path: string) => editor.fieldErrors[`checkout.${path}`] ?? null;
  const policyErr = (path: string) => editor.fieldErrors[`policy.${path}`] ?? null;
  const feeMinor = pesosToMinor(fee);
  const deliveryDirty = Boolean(savedPolicy && (
    delivery.enabled !== savedPolicy.delivery.enabled ||
    feeMinor !== savedPolicy.delivery.fee_minor ||
    delivery.notes !== savedPolicy.delivery.notes
  ));
  const deliveryLocked = reservationsLocked;
  const halfHours = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
  const updateDelivery = (patch: Partial<StorefrontPolicyRules["delivery"]>) => {
    setDelivery((current) => ({ ...current, ...patch }));
    editor.markEdited();
  };
  const saveChanges = async () => {
    if (checkout.dirty && !(await save(draft))) return;
    if (!deliveryDirty || !savedPolicy || feeMinor === null) return;
    await editor.savePolicy({ ...savedPolicy, delivery: { ...delivery, fee_minor: feeMinor } });
  };

  return (
    <PageShell>
      <PageHeader title="Booking settings" description="When renters can book, and for how long." />
      <div className="grid gap-4">
        <Section icon={CalendarCheck} title="Online reservations">
          <Switch
            label="Take reservations online"
            description={reservationsLocked ? "Free storefronts support availability checks and shop contact only." : "Renters can pick dates and reserve on your storefront. Turn this off to keep your storefront for browsing only; renters will be asked to contact you to reserve."}
            checked={reservationsLocked ? false : draft.reservation_requests}
            onChange={(reservation_requests) => checkout.update({ reservation_requests })}
            onLocked={reservationsLocked ? () => requestUpgrade("online storefront reservations") : undefined}
          />
          {!draft.reservation_requests ? (
            <p className="mt-2 text-xs text-dashboard-muted">
              Your storefront stays live with your collection, prices, and contact details. You can still create reservations from the Reservations page.
            </p>
          ) : null}
        </Section>
        <Section icon={Truck} title="Delivery" description={deliveryLocked ? "Free storefronts support availability checks and shop contact only." : "Pickup is always available. Turn on delivery to let renters choose it."}>
          {!savedPolicy ? (
            <p className="mb-2 text-sm text-dashboard-muted">
              Publish a rental policy before changing delivery settings. <Link href="/storefront/policies" className="font-medium text-dashboard-accent hover:underline">Go to Rental policies</Link>.
            </p>
          ) : null}
          <Switch
            label="Offer delivery"
            checked={deliveryLocked ? false : delivery.enabled}
            disabled={!savedPolicy && !deliveryLocked}
            onChange={(enabled) => updateDelivery({ enabled })}
            onLocked={deliveryLocked ? () => requestUpgrade("storefront delivery") : undefined}
          />
          {delivery.enabled && !deliveryLocked && savedPolicy ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <Field label="Delivery fee (₱)" error={feeMinor === null ? "Enter an amount like 150 or 150.50." : policyErr("delivery.fee_minor")}>
                {(props) => <Input {...props} inputMode="decimal" value={fee} onChange={(e) => { setFee(e.target.value); editor.markEdited(); }} />}
              </Field>
              <Field label="Delivery notes" hint="Areas you cover and how it is arranged." error={policyErr("delivery.notes")}>
                {(props) => <Textarea {...props} rows={2} maxLength={600} value={delivery.notes ?? ""} onChange={(e) => updateDelivery({ notes: e.target.value.trim() ? e.target.value : null })} />}
              </Field>
            </div>
          ) : null}
          {delivery.enabled && deliveryLocked ? (
            <p className="mt-2 text-xs text-dashboard-muted">Your saved delivery settings are inactive on Free and will return if you upgrade.</p>
          ) : null}
        </Section>
        <Section icon={CalendarClock} title="Rental timing">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Handover time" hint="Pickup and return both happen at this time." error={err("handover_time")}>
              {(props) => (
                <select {...props} value={draft.handover_time} onChange={(e) => checkout.update({ handover_time: e.target.value })} className="h-10 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30">
                  {halfHours.map((time) => (
                    <option key={time} value={time}>
                      {new Date(`2000-01-01T${time}:00`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Minimum notice (days)" hint="0 allows same-day bookings." error={err("min_notice_days")}>
              {(props) => <Input {...props} type="number" min={0} max={60} value={draft.min_notice_days} onChange={(e) => checkout.update({ min_notice_days: Number(e.target.value) })} />}
            </Field>
            <Field label="Longest rental (days)" error={err("max_rental_days")}>
              {(props) => <Input {...props} type="number" min={1} max={30} value={draft.max_rental_days} onChange={(e) => checkout.update({ max_rental_days: Number(e.target.value) })} />}
            </Field>
          </div>
        </Section>
        <Section icon={CalendarClock} title="Fittings">
          <Switch
            label="Take fitting requests online"
            description="Renters can request a fitting time. Each request arrives as pending for you to confirm."
            checked={draft.fitting_requests}
            onChange={(fitting_requests) => checkout.update({ fitting_requests })}
            onLocked={fittingsLocked ? () => requestUpgrade("storefront fitting requests") : undefined}
          />
          <p className="mt-2 text-xs text-dashboard-muted">
            Times follow{" "}
            <Link href="/settings" className="font-medium text-dashboard-accent hover:underline">
              Settings › Business hours
            </Link>
            . Duration, fee, capacity, and whether fittings are enabled are managed from the Fitting settings dialog on the Fittings page.
          </p>
        </Section>
        <Section icon={Info} title="Payment methods">
          <p className="text-sm text-dashboard-muted">
            {reservationsLocked
              ? "Payment methods remain available for staff-created reservations. Storefront payments are locked on Free. Manage staff methods or view the storefront upgrade option in "
              : "Renters pay with the online methods you mark as available on the storefront in "}
            <Link href="/settings/payment-methods" className="font-medium text-dashboard-accent hover:underline">
              Settings › Payment methods
            </Link>
            .
          </p>
        </Section>
      </div>
      <SaveBar
        dirty={checkout.dirty || deliveryDirty}
        saving={editor.saving}
        state={editor.saveState}
        label={deliveryDirty && !checkout.dirty ? "Save delivery settings" : "Save changes"}
        onSave={() => { void saveChanges(); }}
      />
    </PageShell>
  );
}
