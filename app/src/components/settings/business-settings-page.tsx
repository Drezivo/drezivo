"use client";

import { Building2, CheckCircle2, CircleDashed, Globe2, Mail, MapPin, Phone } from "lucide-react";

import {
  businessInformation,
  type BusinessInformation,
  type BusinessSettings,
} from "@drezivo/contracts";

import { ErrorState, Field, LoadingState, SaveBar, Section } from "@/components/forms/form-kit";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { BusinessHoursSettingsSection } from "./business-hours-settings-section";
import { useSettingsResource } from "./use-settings-resource";

const toDraft = (value: BusinessSettings): BusinessInformation => ({
  business_name: value.business_name,
  business_email: value.business_email,
  business_phone: value.business_phone,
  business_address: value.business_address,
});
const orNull = (text: string): string | null => (text.trim() === "" ? null : text);

export function BusinessSettingsPage() {
  const resource = useSettingsResource<BusinessSettings, BusinessInformation>({
    load: (client) => client.getBusinessSettings(),
    save: (client, current, draft, key) => client.updateBusinessSettings({ version: current.version, ...businessInformation.parse(draft) }, key),
    toDraft,
  });

  if (!resource.draft || !resource.value) {
    return resource.loadError ? <ErrorState message={resource.loadError} onRetry={resource.reload} /> : <LoadingState label="Loading business information…" />;
  }
  const { draft, value } = resource;
  const parsed = businessInformation.safeParse(draft);
  const errors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
  const err = (key: keyof BusinessInformation) => (resource.dirty ? (errors[key] ?? null) : null);
  const complete = Boolean(value.business_email && value.business_phone && value.business_address);

  return (
    <div className="grid gap-4">
      <Section icon={Building2} title="Business information" description="Used on your records, receipts, and the emails Drezivo sends for you. Your public storefront details are edited in Storefront.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" className="sm:col-span-2" error={err("business_name")} count={{ value: draft.business_name.length, max: 120 }}>
            {(props) => <Input {...props} value={draft.business_name} maxLength={120} autoComplete="organization" onChange={(e) => resource.update({ business_name: e.target.value })} />}
          </Field>
          <Field label="Business email" hint="Owner alerts about new requests go here." error={err("business_email")}>
            {(props) => <Input {...props} type="email" autoComplete="email" value={draft.business_email ?? ""} onChange={(e) => resource.update({ business_email: orNull(e.target.value) })} />}
          </Field>
          <Field label="Business phone" error={err("business_phone")}>
            {(props) => <Input {...props} type="tel" autoComplete="tel" value={draft.business_phone ?? ""} placeholder="+63 917 123 4567" onChange={(e) => resource.update({ business_phone: orNull(e.target.value) })} />}
          </Field>
          <Field label="Business address" className="sm:col-span-2" error={err("business_address")}>
            {(props) => <Textarea {...props} rows={2} maxLength={300} value={draft.business_address ?? ""} onChange={(e) => resource.update({ business_address: orNull(e.target.value) })} />}
          </Field>
        </div>
      </Section>

      <BusinessHoursSettingsSection />

      <div className="grid gap-4 md:grid-cols-2">
        <Section icon={Globe2} title="Regional settings" description="Drezivo currently runs in one region.">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-dashboard-muted">Time zone</dt>
              <dd className="font-medium text-dashboard-navy">{value.timezone === "Asia/Manila" ? "Asia/Manila (GMT+8)" : value.timezone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-dashboard-muted">Currency</dt>
              <dd className="font-medium text-dashboard-navy">{value.currency === "PHP" ? "Philippine peso (₱)" : value.currency}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-dashboard-muted">Prices, dates, and reminders all use these. Other regions are not available yet.</p>
        </Section>

        <Section icon={complete ? CheckCircle2 : CircleDashed} title={complete ? "Your business is set up" : "Finish your business details"}>
          <ul className="grid gap-2 text-sm">
            {[
              { icon: Mail, value: value.business_email, empty: "No business email" },
              { icon: Phone, value: value.business_phone, empty: "No business phone" },
              { icon: MapPin, value: value.business_address, empty: "No address" },
            ].map(({ icon: Icon, value: text, empty }) => (
              <li key={empty} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-muted" />
                <span className={text ? "text-dashboard-navy" : "text-dashboard-muted"}>{text ?? empty}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <SaveBar dirty={resource.dirty && parsed.success} saving={resource.saving} state={resource.state} onSave={() => void resource.save()} />
    </div>
  );
}
