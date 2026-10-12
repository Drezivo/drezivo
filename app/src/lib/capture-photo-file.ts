export type CapturedPhotoFile = {
  body: Blob;
  sha256: string;
};

/** Reads a picker-backed file once and returns stable in-memory bytes for preview and upload. */
export async function capturePhotoFile(file: File): Promise<CapturedPhotoFile> {
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return {
    body: new Blob([bytes], { type: file.type }),
    sha256: btoa(binary),
  };
}
