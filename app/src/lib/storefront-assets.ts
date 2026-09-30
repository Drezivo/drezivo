import type { FileObjectId } from "@drezivo/contracts";

import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

export const STOREFRONT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const STOREFRONT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

type ImageType = (typeof STOREFRONT_IMAGE_TYPES)[number];
type UploadType = ImageType | "application/pdf";
export type ImageUploadPurpose =
  | "storefront_asset"
  | "measurement_guide"
  | "payment_method_material"
  | "subscription_payment_proof";

/** Purposes whose files may also be PDFs: a business's ready-made payment instructions, and payment proof. */
const PDF_PURPOSES: ReadonlySet<ImageUploadPurpose> = new Set(["payment_method_material", "subscription_payment_proof"]);
export const acceptsPdf = (purpose: ImageUploadPurpose): boolean => PDF_PURPOSES.has(purpose);

/** One upload intent per chosen file, so a retry after a network error replays instead of duplicating. */
export interface UploadIntent {
  fingerprint: string;
  uploadKey: string;
  finalizeKey: string;
}

/**
 * Quick checks before reading the file. The real format is decided from the file's bytes during
 * upload (see detectImageType), because a file's extension and reported type are often wrong.
 */
export function storefrontImageProblem(file: File, purpose: ImageUploadPurpose = "storefront_asset"): string | null {
  const pdf = acceptsPdf(purpose);
  if (file.type && !file.type.startsWith("image/") && !(pdf && file.type === "application/pdf")) {
    return pdf ? "Choose a PDF or an image file: JPEG, PNG, or WebP." : "Choose an image file: JPEG, PNG, or WebP.";
  }
  if (file.size > STOREFRONT_IMAGE_MAX_BYTES) return "Images must be 10 MB or smaller.";
  return null;
}

/**
 * The image format according to the file's first bytes. Images saved from the web are often a JPEG
 * or WebP named ".png"; declaring the real type lets the server's signature check accept them.
 * Anything else gets a message naming the format, so the owner knows what to convert.
 */
export async function detectImageType(file: File): Promise<ImageType> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  const brand = ascii(4, 12);
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) throw new Error("This is a HEIC photo (the iPhone format). Save it as JPEG or PNG, then upload it again.");
  if (/^ftyp(avif|avis)/.test(brand)) throw new Error("This is an AVIF image. Save it as JPEG, PNG, or WebP, then upload it again.");
  if (ascii(0, 3) === "GIF") throw new Error("GIF images are not supported. Use a JPEG, PNG, or WebP image.");
  throw new Error("This file is not a JPEG, PNG, or WebP image, even if its name says so. Save it as one of those and try again.");
}

/** Like detectImageType, and also recognises a PDF (`%PDF-`) when the purpose allows one. */
export async function detectUploadType(file: File, purpose: ImageUploadPurpose): Promise<UploadType> {
  if (acceptsPdf(purpose)) {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) === "%PDF-") return "application/pdf";
  }
  return detectImageType(file);
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
  const problem = storefrontImageProblem(file, purpose);
  if (problem) throw new Error(problem);
  const contentType = await detectUploadType(file, purpose);

  const fingerprint = `${purpose}|${file.name}|${contentType}|${file.size}|${file.lastModified}`;
  const intent =
    intentRef.current?.fingerprint === fingerprint
      ? intentRef.current
      : { fingerprint, uploadKey: intentKey(`${purpose}_upload`), finalizeKey: intentKey(`${purpose}_finalize`) };
  intentRef.current = intent;

  const client = createDrezivoApiClient(getToken);
  try {
    const authorized = await client.authorizeUpload(
      { purpose, content_type: contentType, byte_size: file.size, sha256: await sha256Base64(file) },
      intent.uploadKey,
    );
    await uploadAuthorizedFile(
      authorized.data,
      file,
      "The upload did not finish. Try again.",
    );
    const finalized = await client.finalizeUpload(authorized.data.file_id, intent.finalizeKey);
    return finalized.data.file.file_id;
  } catch (error) {
    // A definite rejection (bad file, expired upload) is final for that upload, so the next try must
    // start a new one; replaying it would only repeat "This upload can no longer be finalized".
    if (error instanceof DrezivoApiError && error.status < 500 && error.status !== 408 && error.status !== 429) {
      intentRef.current = null;
    }
    throw error;
  }
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
