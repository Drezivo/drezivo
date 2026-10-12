import { describe, expect, it } from "vitest";

import {
  capturePhotoFile,
  mayBeSupportedPhoto,
  UnsupportedPhotoTypeError,
  unusablePhotoMessage,
} from "@/lib/capture-photo-file";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0];
const WEBP = [...ascii("RIFF"), 4, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")];
const HEIC = [0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0];
const AVIF = [0, 0, 0, 0x1c, ...ascii("ftyp"), ...ascii("avif"), 0, 0, 0, 0];

function file(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

describe("capturePhotoFile", () => {
  it.each([
    ["photo.jpg", JPEG, "image/jpeg"],
    ["photo.png", PNG, "image/png"],
    ["photo.webp", WEBP, "image/webp"],
  ])("detects %s from its bytes", async (name, bytes, expected) => {
    const captured = await capturePhotoFile(file(bytes, name, expected));
    expect(captured.contentType).toBe(expected);
    expect(captured.body.type).toBe(expected);
    expect(Array.from(new Uint8Array(await captured.body.arrayBuffer()))).toEqual(bytes);
    expect(captured.sha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("declares the real type when the file name lies (a JPEG saved as .webp)", async () => {
    // Prod 2026-10-12: a .webp-named upload was rejected at finalize because its bytes were not WebP.
    const captured = await capturePhotoFile(file(JPEG, "dress.webp", "image/webp"));
    expect(captured.contentType).toBe("image/jpeg");
  });

  it("accepts a file the picker reports with no type when the bytes are an image", async () => {
    const picked = file(PNG, "IMG_0001", "");
    expect(mayBeSupportedPhoto(picked)).toBe(true);
    expect((await capturePhotoFile(picked)).contentType).toBe("image/png");
  });

  it.each([
    ["phone.jpg", HEIC, "HEIC"],
    ["web.webp", AVIF, "AVIF"],
  ])("names a %s that is really %s so the owner knows to convert it", async (name, bytes, format) => {
    const error = await capturePhotoFile(file(bytes, name, "image/jpeg")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnsupportedPhotoTypeError);
    expect(unusablePhotoMessage(error, name)).toBe(
      `“${name}” is a ${format} image. Save it as JPG or PNG, then select it again.`
    );
  });

  it("rejects unknown bytes instead of uploading something the API will refuse", async () => {
    const error = await capturePhotoFile(file([1, 2, 3], "x.png", "image/png")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnsupportedPhotoTypeError);
  });

  it("explains an unreadable file as a read problem, not a type problem", () => {
    const readError = new DOMException("The requested file could not be read", "NotReadableError");
    expect(unusablePhotoMessage(readError, "a.jpg")).toContain("Could not read “a.jpg”");
  });

  it("still rejects types the picker clearly reports as unsupported", () => {
    expect(mayBeSupportedPhoto(file(PNG, "a.gif", "image/gif"))).toBe(false);
    expect(mayBeSupportedPhoto(file(PNG, "a.heic", "image/heic"))).toBe(false);
  });
});
