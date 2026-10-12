export type PhotoContentType = "image/jpeg" | "image/png" | "image/webp";

export type CapturedPhotoFile = {
  body: Blob;
  sha256: string;
  /** Detected from the bytes, not the file name, so it matches the API's signature check. */
  contentType: PhotoContentType;
};

/** The picked file is not a JPEG, PNG, or WebP image, whatever its name says. */
export class UnsupportedPhotoTypeError extends Error {
  constructor(readonly fileName: string, readonly detectedFormat: string | null) {
    super(
      detectedFormat
        ? `“${fileName}” is a ${detectedFormat} image. Save it as JPG or PNG, then select it again.`
        : `“${fileName}” is not a JPG, PNG, or WebP image. Save it as JPG or PNG, then select it again.`
    );
    this.name = "UnsupportedPhotoTypeError";
  }
}

/** What to tell the user when a picked image cannot be captured. */
export function unusablePhotoMessage(error: unknown, fileName: string): string {
  if (error instanceof UnsupportedPhotoTypeError) return error.message;
  return `Could not read “${fileName}”. Save or download the image to your device, remove this photo, then select the local copy.`;
}

/**
 * Picker types the browser may report for a supported image. An empty type is common on Android
 * pickers and for renamed files, so the bytes decide instead.
 */
export function mayBeSupportedPhoto(file: File): boolean {
  return file.type === "" || ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

/**
 * Reads a picker-backed file once and returns stable in-memory bytes for preview and upload.
 * Reading later (at save time) fails in some browsers with NotReadableError once the picker's
 * access lapses, so callers must capture right after selection.
 */
export async function capturePhotoFile(file: File): Promise<CapturedPhotoFile> {
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16));
  const contentType = detectPhotoContentType(head);
  if (!contentType) throw new UnsupportedPhotoTypeError(file.name, describeOtherFormat(head));

  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return {
    body: new Blob([bytes], { type: contentType }),
    sha256: btoa(binary),
    contentType,
  };
}

/** Mirrors the API's magic-byte check in files.service.ts, so an accepted pick finalizes. */
export function detectPhotoContentType(head: Uint8Array): PhotoContentType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((value, index) => head[index] === value)) return "image/png";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Names the formats phones and websites commonly hand out, so the message says what to do. */
function describeOtherFormat(head: Uint8Array): string | null {
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand.startsWith("avi")) return "AVIF";
    if (brand.startsWith("hei") || brand.startsWith("hev") || brand === "mif1" || brand === "msf1") return "HEIC";
  }
  if (head.length >= 4 && ascii(head, 0, 4) === "GIF8") return "GIF";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
