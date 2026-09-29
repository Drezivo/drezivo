"use client";

import { useAuth } from "@clerk/nextjs";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { FileObjectId } from "@drezivo/contracts";

import { storefrontImageProblem, uploadStorefrontImage, type UploadIntent } from "@/lib/storefront-assets";
import { cn } from "@/lib/utils";

/**
 * Uploads as soon as a file is chosen and hands back the accepted file id. The preview shows the
 * local file immediately; the saved image comes back as a signed URL after the document is saved.
 */
export function ImageField({
  label,
  hint,
  fileId,
  savedUrl,
  aspect = "aspect-[16/9]",
  onChange,
}: {
  label: string;
  hint: string;
  fileId: FileObjectId | null;
  savedUrl: string | null;
  aspect?: string;
  onChange: (fileId: FileObjectId | null) => void;
}) {
  const { getToken } = useAuth();
  const inputId = useId();
  const intentRef = useRef<UploadIntent | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  async function choose(file: File | undefined) {
    if (!file || uploading) return;
    const problem = storefrontImageProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    setLocalUrl(URL.createObjectURL(file));
    try {
      onChange(await uploadStorefrontImage(file, getToken, intentRef));
      intentRef.current = null;
    } catch (caught) {
      setLocalUrl(null);
      setError(caught instanceof Error ? caught.message : "The image could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  const preview = localUrl ?? (fileId ? savedUrl : null);

  return (
    <div>
      <p className="text-sm font-medium text-dashboard-navy">{label}</p>
      <div className={cn("relative mt-1.5 overflow-hidden rounded-lg border border-dashed border-dashboard-border bg-dashboard-canvas", aspect)}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL or short-lived signed URL
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <label htmlFor={inputId} className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 text-sm text-dashboard-muted hover:bg-dashboard-active/50">
            <ImagePlus className="h-5 w-5" />
            Choose image
          </label>
        )}
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-white" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
          </div>
        ) : null}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-dashboard-muted">{hint}</p>
        {preview && !uploading ? (
          <span className="flex shrink-0 gap-1">
            <label htmlFor={inputId} className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-dashboard-accent hover:bg-dashboard-active">
              Replace
            </label>
            <button
              type="button"
              onClick={() => {
                setLocalUrl(null);
                onChange(null);
              }}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-dashboard-danger hover:bg-dashboard-danger/10"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
            </button>
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-dashboard-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
