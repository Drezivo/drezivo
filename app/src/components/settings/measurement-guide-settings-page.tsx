"use client";

import { useAuth } from "@clerk/nextjs";
import { Ruler } from "lucide-react";
import { useEffect, useState } from "react";

import { saveMeasurementGuideRequest, type FileObjectId, type MeasurementGuide } from "@drezivo/contracts";

import { ErrorState, Field, LoadingState, SaveBar, Section, type SaveState } from "@/components/forms/form-kit";
import { ImageField } from "@/components/storefront/image-field";
import { Input } from "@/components/ui/input";
import { messageOf } from "@/components/settings/use-settings-resource";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type Draft = { name: string; fileId: FileObjectId | null };

/**
 * The workspace's default measurement guide, stored by the catalogue API. New clothing sizes that
 * choose "Default guide" reference it; saving a new one leaves existing clothing on its old guide.
 */
export function MeasurementGuideSettingsPage() {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [guide, setGuide] = useState<MeasurementGuide | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    createDrezivoApiClient(getToken)
      .getDefaultMeasurementGuide()
      .then((result) => {
        if (cancelled) return;
        setGuide(result.data.guide);
        setDraft({ name: result.data.guide?.name ?? "", fileId: result.data.guide?.file_id ?? null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(messageOf(error, "Could not load your measurement guide."));
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, reloadToken]);

  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />;
  if (!draft) return <LoadingState label="Loading your measurement guide…" />;

  const dirty = draft.name.trim() !== (guide?.name ?? "") || draft.fileId !== (guide?.file_id ?? null);
  const nameError = draft.name.trim() ? null : "Give the guide a name, for example Standard size guide.";

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    guard.resetIntent();
    setState({ kind: "idle" });
  }

  async function save() {
    if (!draft) return;
    const parsed = saveMeasurementGuideRequest.safeParse({ name: draft.name, file_id: draft.fileId, make_default: true });
    if (!parsed.success) {
      setState({ kind: "error", message: draft.fileId ? "Give the guide a name." : "Add the measurement guide image first." });
      return;
    }
    try {
      const saved = await guard.submit((key) => createDrezivoApiClient(getToken).saveMeasurementGuide(parsed.data, key));
      if (!saved) return;
      // Re-read so the preview comes back as a fresh signed URL for the saved image.
      const refreshed = await createDrezivoApiClient(getToken).getDefaultMeasurementGuide().catch(() => null);
      const current = refreshed?.data.guide ?? saved.data;
      setGuide(current);
      setDraft({ name: current.name, fileId: current.file_id });
      guard.resetIntent();
      setState({ kind: "saved" });
    } catch (error) {
      setState({ kind: "error", message: messageOf(error, "Could not save the measurement guide.") });
    }
  }

  return (
    <div className="grid gap-4">
      <Section
        icon={Ruler}
        title="Default measurement guide"
        description="One size or measurement chart that clothing can reuse instead of storing the same measurements on every size."
      >
        <div className="grid gap-5">
          <Field label="Guide name" error={draft.name.length > 0 ? nameError : null} count={{ value: draft.name.length, max: 160 }}>
            {(props) => (
              <Input
                {...props}
                value={draft.name}
                maxLength={160}
                placeholder="Standard size guide"
                onChange={(event) => update({ name: event.target.value })}
              />
            )}
          </Field>
          <ImageField
            label="Guide image"
            hint="JPG, PNG, or WebP, up to 10 MB. Renters see it on items that use this guide."
            purpose="measurement_guide"
            fit="contain"
            aspect="aspect-[4/3]"
            removable={false}
            fileId={draft.fileId}
            savedUrl={draft.fileId === guide?.file_id ? (guide?.image_url ?? null) : null}
            onChange={(fileId) => update({ fileId })}
          />
          <p className="text-xs leading-5 text-dashboard-muted">
            New sizes that choose &ldquo;Default guide&rdquo; use this one. Clothing you already added keeps the guide it had, and any
            size can still use its own measurements.
          </p>
        </div>
      </Section>
      <SaveBar dirty={dirty} saving={guard.isSubmitting} state={state} onSave={() => void save()} label={guide ? "Save changes" : "Save guide"} />
    </div>
  );
}
