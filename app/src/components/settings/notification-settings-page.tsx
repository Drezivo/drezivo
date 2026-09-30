"use client";

import { AlertTriangle, Bell, Mail, Store, UserRound } from "lucide-react";
import Link from "next/link";

import type { NotificationPreferences, NotificationSettings } from "@drezivo/contracts";

import { ErrorState, LoadingState, SaveBar, Section, Switch } from "@/components/forms/form-kit";

import { useSettingsResource } from "./use-settings-resource";

const toDraft = (value: NotificationSettings): NotificationPreferences => ({
  email_enabled: value.email_enabled,
  customer: value.customer,
  business: value.business,
});

const CUSTOMER: Array<{ key: keyof NotificationPreferences["customer"]; label: string; description: string }> = [
  { key: "request_received", label: "Request received", description: "When a renter sends a request with their receipt." },
  { key: "request_confirmed", label: "Rental confirmed", description: "When you confirm a request." },
  { key: "request_rejected", label: "Request declined", description: "When you decline a request." },
  { key: "request_cancelled", label: "Rental cancelled", description: "When a rental is cancelled." },
  { key: "fitting_requested", label: "Fitting request received", description: "When a renter requests a fitting online." },
];

const BUSINESS: Array<{ key: keyof NotificationPreferences["business"]; label: string; description: string }> = [
  { key: "new_request", label: "New rental request", description: "A renter sent a request and payment receipt." },
  { key: "new_fitting_request", label: "New fitting request", description: "A renter requested a fitting from your storefront." },
];

export function NotificationSettingsPage() {
  const resource = useSettingsResource<NotificationSettings, NotificationPreferences>({
    load: (client) => client.getNotificationSettings(),
    save: (client, current, draft, key) => client.updateNotificationSettings({ version: current.version, ...draft }, key),
    toDraft,
  });

  if (!resource.draft || !resource.value) {
    return resource.loadError ? <ErrorState message={resource.loadError} onRetry={resource.reload} /> : <LoadingState label="Loading notifications…" />;
  }
  const { draft, value } = resource;
  const off = !draft.email_enabled;

  return (
    <div className="grid gap-4">
      <Section icon={Mail} title="Email notifications" description="Choose which emails Drezivo sends on your behalf. Verification codes for renters are always sent.">
        <Switch label="Send email notifications" checked={draft.email_enabled} onChange={(email_enabled) => resource.update({ email_enabled })} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section icon={UserRound} title="To renters" description="Sent to the renter's verified email.">
          <div className="divide-y divide-dashboard-border">
            {CUSTOMER.map((item) => (
              <Switch
                key={item.key}
                label={item.label}
                description={item.description}
                disabled={off}
                checked={draft.customer[item.key]}
                onChange={(checked) => resource.update({ customer: { ...draft.customer, [item.key]: checked } })}
              />
            ))}
          </div>
        </Section>

        <Section icon={Store} title="To your business" description={value.business_recipient ? `Sent to ${value.business_recipient}.` : "Add a business email to receive these."}>
          {!value.business_recipient ? (
            <p className="mb-2 flex items-start gap-2 rounded-md bg-dashboard-gold-soft px-3 py-2 text-xs text-dashboard-gold-text">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No business email yet.{" "}
                <Link href="/settings" className="font-medium underline">
                  Add one in Business information
                </Link>
                .
              </span>
            </p>
          ) : null}
          <div className="divide-y divide-dashboard-border">
            {BUSINESS.map((item) => (
              <Switch
                key={item.key}
                label={item.label}
                description={item.description}
                disabled={off}
                checked={draft.business[item.key]}
                onChange={(checked) => resource.update({ business: { ...draft.business, [item.key]: checked } })}
              />
            ))}
          </div>
        </Section>
      </div>

      <p className="flex items-center gap-2 text-xs text-dashboard-muted">
        <Bell className="h-3.5 w-3.5" /> Emails are queued and retried automatically if the email service is briefly down.
      </p>

      <SaveBar dirty={resource.dirty} saving={resource.saving} state={resource.state} onSave={() => void resource.save()} />
    </div>
  );
}
