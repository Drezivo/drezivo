"use client";

import { Check, ImagePlus, Info, Ruler, Save, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMeasurementGuide } from "@/components/settings/measurement-guide-context";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function MeasurementGuideSettingsPage() {
  const { guide, saveGuide: saveSharedGuide } = useMeasurementGuide();
  const [pendingName, setPendingName] = useState(guide.name);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(
    () => () => {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    },
    [pendingPreviewUrl]
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSaved(false);
    setError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("Use a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Measurement guide images must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingPreviewUrl(URL.createObjectURL(file));
    setPendingFile(file);
    setPendingFileName(file.name);
  };

  const saveGuide = () => {
    const nextName = pendingName.trim();
    if (!nextName) {
      setError("Enter a name for the measurement guide.");
      return;
    }
    saveSharedGuide({ name: nextName, ...(pendingFile ? { file: pendingFile } : {}) });
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingPreviewUrl(null);
    setPendingFile(null);
    setPendingFileName(null);
    setSaved(true);
    setError(null);
  };

  const displayPreview = pendingPreviewUrl ?? guide.previewUrl;

  return (
    <div>
      <div className="w-full">
        <div className="mb-5">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-dashboard-navy">
            Default measurement guide
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-dashboard-muted">
            Upload one reusable size or measurement image for clothing that follows your shop&apos;s standard guide.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <Card className="gap-0 py-0">
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div>
                <label htmlFor="measurement-guide-name" className="mb-2 block text-sm font-medium text-dashboard-navy">
                  Guide Name
                </label>
                <Input
                  id="measurement-guide-name"
                  value={pendingName}
                  onChange={(event) => {
                    setPendingName(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="e.g. Standard Size Guide"
                />
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium text-dashboard-navy">Measurement Image</span>
                <label className="group flex min-h-64 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-dashboard-border bg-dashboard-active/30 p-5 text-center transition-colors hover:bg-dashboard-active focus-within:ring-2 focus-within:ring-dashboard-accent/30">
                  {displayPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- temporary local object URL preview; accepted file bytes are uploaded through the API in the real flow.
                    <img src={displayPreview} alt="Selected measurement guide preview" className="max-h-80 w-full object-contain" />
                  ) : (
                    <>
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl dashboard-tone-blue">
                        <ImagePlus className="h-6 w-6" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-sm font-semibold text-dashboard-navy">Add measurement guide image</p>
                      <p className="mt-1 text-xs text-dashboard-muted">JPG, PNG, or WebP · up to 10 MB</p>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onFileChange}
                    className="sr-only"
                    aria-label="Upload measurement guide image"
                  />
                </label>
                {pendingFileName ? (
                  <p className="mt-2 text-xs text-dashboard-muted">Selected: {pendingFileName}</p>
                ) : null}
                {error ? <p className="mt-2 text-xs font-medium text-dashboard-danger">{error}</p> : null}
              </div>

              <div className="rounded-xl border border-dashboard-border bg-dashboard-active/40 p-4 text-xs leading-5 text-dashboard-muted">
                <div className="flex gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
                  <p>
                    New clothing can reference this guide instead of storing duplicate measurements. A variant can still switch to custom measurements or no measurements when needed.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" className="border border-dashboard-border bg-dashboard-surface" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Upload measurement guide image"]')?.click()}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Replace Image
                </Button>
                <Button onClick={saveGuide}>
                  {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  {saved ? "Saved" : "Save Default Guide"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <aside className="space-y-4 lg:sticky lg:top-4">
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl dashboard-tone-blue">
                  <Ruler className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-dashboard-navy">Current default</p>
                <p className="mt-1 text-sm text-dashboard-navy">{guide.name}</p>
                <p className="mt-1 text-xs leading-5 text-dashboard-muted">
                  Used automatically for new sizes that choose “Default guide.” Existing clothing keeps its previously referenced guide.
                </p>
              </CardContent>
            </Card>

            <div className="rounded-xl border border-dashboard-border bg-dashboard-surface p-4 text-xs leading-5 text-dashboard-muted">
              One shared guide can support hundreds of clothing variants. You only need custom measurements for exceptions.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
