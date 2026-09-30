import type { FileObjectId } from "@drezivo/contracts";

import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

export const STOREFRONT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const STOREFRONT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

type ImageType = (typeof STOREFRONT_IMAGE_TYPES)[number];
export type ImageUploadPurpose = "storefront_asset" | "measurement_guide";

/** One upload intent per chosen file, so a retry after a network error replays instead of duplicating. */
export interface UploadIntent {
  fingerprint: string;
  uploadKey: string;
  finalizeKey: string;
}

export function storefrontImageProblem(file: File): string | null {
  if (!STOREFRONT_IMAGE_TYPES.includes(file.type as ImageType)) return "Use a JPEG, PNG, or WebP image.";
  if (file.size > STOREFRONT_IMAGE_MAX_BYTES) return "Images must be 10 MB or smaller.";
  return null;
}

/**
 * Authorize → direct create-only PUT to storage → finalize. The server re-checks size, type,
 * SHA-256, and file signature before the image can be referenced anywhere.
 */
export async function uploadStorefrontImage(
  file: File,
  getToken: () => Promise<string | null>,
  intentRef: { current: UploadIntent | null },
  purpose: ImageUploadPurpose = "storefront_asset",
): Promise<FileObjectId> {
  const problem = storefrontImageProblem(file);
  if (problem) throw new Error(problem);

  const fingerprint = `${purpose}|${file.name}|${file.type}|${file.size}|${file.lastModified}`;
  const intent =
    intentRef.current?.fingerprint === fingerprint
      ? intentRef.current
      : { fingerprint, uploadKey: intentKey(`${purpose}_upload`), finalizeKey: intentKey(`${purpose}_finalize`) };
  intentRef.current = intent;

  const client = createDrezivoApiClient(getToken);
  const authorized = await client.authorizeUpload(
    { purpose, content_type: file.type as ImageType, byte_size: file.size, sha256: await sha256Base64(file) },
    intent.uploadKey,
  );
  await uploadAuthorizedFile(
    authorized.data,
    file,
    "The image upload did not finish. Try again."
  );
  const finalized = await client.finalizeUpload(authorized.data.file_id, intent.finalizeKey);
  return finalized.data.file.file_id;
}

function intentKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replaceAll("-", "_")}`;
}

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}
