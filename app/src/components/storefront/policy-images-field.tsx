"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowUp, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { STOREFRONT_POLICY_IMAGE_LIMIT, type FileObjectId } from "@drezivo/contracts";

import { storefrontImageProblem, uploadStorefrontImage, type UploadIntent } from "@/lib/storefront-assets";

/**
 * The rental terms as pictures: one image per page, in the order renters read them. Several files
 * can be chosen at once; each uploads in turn and is added as soon as the server accepts it.
 */
export function PolicyImagesField({
  fileIds,
  savedUrls,
  error,
  onChange,
  onUploadingChange,
}: {
  fileIds: readonly FileObjectId[];
  /** Signed URLs of images that are already in a published version, keyed by file id. */
  savedUrls: Readonly<Record<string, string>>;
  error: string | null;
  onChange: (fileIds: FileObjectId[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const { getToken } = useAuth();
  const inputId = useId();
  // One upload intent per chosen file, so choosing the same file again after a failure replays it.
  const intents = useRef(new Map<string, { current: UploadIntent | null }>());
  // Local previews for pages uploaded in this visit; read during the render that onChange triggers.
  const previews = useRef(new Map<string, string>());
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const room = STOREFRONT_POLICY_IMAGE_LIMIT - fileIds.length;

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function add(files: File[]) {
    if (uploading || files.length === 0) return;
    const chosen = files.slice(0, room);
    const invalid = chosen.map((file) => storefrontImageProblem(file)).find((message) => message !== null);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(
      files.length > room ? `Up to ${STOREFRONT_POLICY_IMAGE_LIMIT} pages. The first ${room} were added.` : null
    );
    setUploading(true);
    onUploadingChange(true);
    let ids = [...fileIds];
    try {
      for (const file of chosen) {
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        const intent = intents.current.get(key) ?? { current: null };
        intents.current.set(key, intent);
        const id = await uploadStorefrontImage(file, getToken, intent);
        intents.current.delete(key);
        previews.current.set(id, URL.createObjectURL(file));
        ids = [...ids, id];
        onChange(ids);
      }
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : "A page could not be uploaded. Try again.");
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  const move = (index: number) => {
    const next = [...fileIds];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    onChange(next);
  };

  return (
    <div className="relative">
      {fileIds.length > 0 ? (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fileIds.map((id, index) => {
            const url = previews.current.get(id) ?? savedUrls[id] ?? null;
            return (
              <li key={id} className="overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-canvas">
                <div className="relative aspect-[3/4] bg-white">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL or short-lived signed URL
                    <img src={url} alt={`Policy page ${index + 1}`} className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <p className="absolute inset-0 flex items-center justify-center text-xs text-dashboard-muted">Preview unavailable</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-xs font-medium text-dashboard-navy">Page {index + 1}</span>
                  <span className="flex gap-1">
                    {index > 0 ? (
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => move(index)}
                        className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-dashboard-accent hover:bg-dashboard-active disabled:opacity-50"
                      >
                        <ArrowUp className="mr-1 h-3.5 w-3.5" /> Move up
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => onChange(fileIds.filter((other) => other !== id))}
                      className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-dashboard-danger hover:bg-dashboard-danger/10 disabled:opacity-50"
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {room > 0 ? (
        <label
          htmlFor={inputId}
          aria-disabled={uploading}
          className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-dashboard-border bg-dashboard-canvas px-4 py-8 text-sm text-dashboard-muted hover:bg-dashboard-active/50 aria-disabled:cursor-wait"
        >
          {uploading ? (
            <span role="status" className="inline-flex items-center gap-2 font-medium text-dashboard-navy">
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </span>
          ) : (
            <>
              <ImagePlus className="h-5 w-5" />
              <span className="font-medium text-dashboard-navy">{fileIds.length === 0 ? "Upload your policy" : "Add pages"}</span>
              <span className="text-xs">
                JPEG, PNG, or WebP up to 10 MB each. Up to {STOREFRONT_POLICY_IMAGE_LIMIT} pages, shown in this order.
              </span>
            </>
          )}
        </label>
      ) : null}
      <input
        id={inputId}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          void add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {problem ?? error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-dashboard-danger">
          {problem ?? error}
        </p>
      ) : null}
    </div>
  );
}
