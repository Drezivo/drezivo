"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Clock3, Save, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { FittingSettings } from "@drezivo/contracts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

type Draft = {
  enabled: boolean;
  capacity: string;
  durationMinutes: string;
  fee: string;
};

export function FittingSchedulePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [settings, setSettings] = useState<FittingSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveGuard = useSubmitGuard();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void createDrezivoApiClient(getToken)
      .getFittingSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result.data);
        setDraft(toDraft(result.data));
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
  }, [getToken, isLoaded, isSignedIn]);

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
    } catch (caught) {
      setError(messageOf(caught, "Could not save fitting settings."));
    }
  };

  if (loading) {
    return <div className="py-10 text-sm text-dashboard-muted">Loading fitting settings…</div>;
  }
  if (!settings || !draft) {
    return (
      <div className="rounded-lg border border-dashboard-danger/30 p-4 text-sm text-dashboard-danger">
        {error ?? "Fitting settings could not be loaded."}
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <Link href="/fittings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-2")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to fittings
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
            <Settings2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold text-dashboard-navy">Fitting settings</h1>
            <p className="mt-0.5 text-sm text-dashboard-muted">
              Fittings follow your active branch Business Hours. This page only controls fitting-specific behavior.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-dashboard-border bg-white p-5 sm:p-6">
        <label className="flex items-start justify-between gap-4 border-b border-dashboard-border pb-4">
          <span>
            <span className="block text-sm font-medium text-dashboard-navy">Accept fitting appointments</span>
            <span className="mt-1 block text-xs text-dashboard-muted">Turn this off to stop new fitting bookings.</span>
          </span>
          <input
            type="checkbox"
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

        {error ? <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{error}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashboard-border pt-4">
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm font-medium text-dashboard-accent hover:underline">
            <Clock3 className="h-4 w-4" /> Manage Business Hours
          </Link>
          <Button type="button" disabled={!dirty || saveGuard.isSubmitting} onClick={() => void save()}>
            <Save className="mr-2 h-4 w-4" /> {saveGuard.isSubmitting ? "Saving…" : "Save fitting settings"}
          </Button>
        </div>
      </div>
    </div>
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
