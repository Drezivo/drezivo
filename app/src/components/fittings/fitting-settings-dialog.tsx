"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { Clock3, Loader2, Save, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { FittingSettings } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type Draft = {
  enabled: boolean;
  capacity: string;
  durationMinutes: string;
  fee: string;
};

export function FittingSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: FittingSettings) => void;
}) {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<FittingSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const saveGuard = useSubmitGuard();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void createDrezivoApiClient(getToken)
      .getFittingSettings()
      .then(({ data }) => {
        if (cancelled) return;
        setSettings(data);
        setDraft(toDraft(data));
        saveGuard.resetIntent();
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageOf(caught, "Could not load fitting settings."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, open, reloadVersion, saveGuard.resetIntent]);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    saveGuard.resetIntent();
    setError(null);
  };

  const save = async () => {
    if (!settings || !draft) return;
    const capacity = positiveInteger(draft.capacity, 100);
    const duration = positiveInteger(draft.durationMinutes, 24 * 60);
    const feeMinor = currencyToMinor(draft.fee);
    if (capacity === null) {
      setError("Maximum simultaneous fittings must be a whole number from 1 to 100.");
      return;
    }
    if (duration === null || duration < 30 || duration % 30 !== 0) {
      setError("Appointment duration must be 30-minute steps from 30 to 1,440 minutes.");
      return;
    }
    if (feeMinor === null) {
      setError("Enter a valid non-negative fitting fee.");
      return;
    }

    try {
      setError(null);
      const result = await saveGuard.submit((key) =>
        createDrezivoApiClient(getToken).updateFittingSettings(
          {
            version: settings.version,
            enabled: draft.enabled,
            capacity,
            duration_minutes: duration,
            fee_minor: feeMinor,
          },
          key,
        ),
      );
      if (!result) return;
      setSettings(result.data.settings);
      setDraft(toDraft(result.data.settings));
      saveGuard.resetIntent();
      onSaved(result.data.settings);
      onOpenChange(false);
    } catch (caught) {
      setError(messageOf(caught, "Could not save fitting settings."));
    }
  };

  const dirty = settings !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(settings));

  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => !saveGuard.isSubmitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
                <Settings2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Fitting settings</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                  Control fitting-specific behavior. Fittings follow the active branch Business Hours.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close fitting settings" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {loading ? (
            <div role="status" className="mt-6 flex min-h-40 items-center justify-center gap-2 text-sm text-dashboard-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading fitting settings…
            </div>
          ) : !settings || !draft ? (
            <div className="mt-6 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/5 p-4 text-sm text-dashboard-danger" role="alert">
              <p>{error ?? "Fitting settings could not be loaded."}</p>
              <Button type="button" variant="secondary" className="mt-3" onClick={() => setReloadVersion((value) => value + 1)}>Try again</Button>
            </div>
          ) : (
            <>
              <label className="mt-6 flex items-start justify-between gap-4 border-b border-dashboard-border pb-4">
                <span>
                  <span className="block text-sm font-medium text-dashboard-navy">Accept fitting appointments</span>
                  <span className="mt-1 block text-xs text-dashboard-muted">Turn this off to stop new fitting bookings.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Accept fitting appointments"
                  aria-checked={draft.enabled}
                  checked={draft.enabled}
                  onChange={(event) => updateDraft({ enabled: event.target.checked })}
                  className="mt-1 h-4 w-4"
                />
              </label>

              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Field label="Maximum simultaneous fittings">
                  <Input aria-label="Maximum simultaneous fittings" value={draft.capacity} inputMode="numeric" onChange={(event) => updateDraft({ capacity: event.target.value })} />
                </Field>
                <Field label="Appointment duration">
                  <div className="relative">
                    <Input aria-label="Appointment duration" value={draft.durationMinutes} inputMode="numeric" className="pr-16" onChange={(event) => updateDraft({ durationMinutes: event.target.value })} />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-dashboard-muted">min</span>
                  </div>
                </Field>
                <Field label={`Fitting fee (${settings.currency})`}>
                  <Input aria-label={`Fitting fee (${settings.currency})`} value={draft.fee} inputMode="decimal" onChange={(event) => updateDraft({ fee: event.target.value })} />
                </Field>
              </div>

              <div className="mt-5 rounded-lg border border-dashboard-border bg-dashboard-canvas/60 p-3 text-sm text-dashboard-muted">
                <div className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    Fitting times and closed dates follow active-branch Business Hours.{" "}
                    <Link href="/settings" onClick={() => onOpenChange(false)} className="font-medium text-dashboard-accent hover:underline">Manage business hours</Link>
                  </p>
                </div>
              </div>

              {error ? <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{error}</p> : null}

              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-dashboard-border pt-4 sm:flex-row sm:justify-end">
                <Dialog.Close asChild><Button type="button" variant="secondary" disabled={saveGuard.isSubmitting}>Cancel</Button></Dialog.Close>
                <Button type="button" disabled={!dirty || saveGuard.isSubmitting} onClick={() => void save()}>
                  {saveGuard.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  {saveGuard.isSubmitting ? "Saving…" : "Save fitting settings"}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

function toDraft(settings: FittingSettings): Draft {
  return {
    enabled: settings.enabled,
    capacity: String(settings.capacity),
    durationMinutes: String(settings.duration_minutes),
    fee: minorToCurrency(settings.fee_minor),
  };
}

function positiveInteger(value: string, maximum: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function currencyToMinor(value: string): string | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return null;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
}

function minorToCurrency(value: string): string {
  const minor = BigInt(value);
  const whole = minor / 100n;
  const fraction = String(minor % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) {
    if (error.code === "STALE_VERSION") return "Fitting settings changed elsewhere. Reload and try again.";
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
