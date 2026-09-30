import { describe, expect, it } from "vitest";

import { detectImageType, storefrontImageProblem } from "@/lib/storefront-assets";

const file = (bytes: number[], name: string, type: string) => new File([new Uint8Array([...bytes, ...new Array(32).fill(0)])], name, { type });

describe("storefront image checks", () => {
  it("uses the real format of a JPEG that was saved with a .png name", async () => {
    await expect(detectImageType(file([0xff, 0xd8, 0xff, 0xe0], "photo.png", "image/png"))).resolves.toBe("image/jpeg");
  });

  it("recognises PNG and WebP from their bytes", async () => {
    await expect(detectImageType(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a.png", "image/png"))).resolves.toBe("image/png");
    const webp = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)));
    await expect(detectImageType(file(webp, "a.jpg", "image/jpeg"))).resolves.toBe("image/webp");
  });

  it("names formats it cannot take instead of failing later on the server", async () => {
    const heic = [0, 0, 0, 24, ..."ftypheic".split("").map((c) => c.charCodeAt(0))];
    await expect(detectImageType(file(heic, "IMG_0001.png", "image/png"))).rejects.toThrow(/HEIC/);
    await expect(detectImageType(file([1, 2, 3, 4], "notes.png", "image/png"))).rejects.toThrow(/not a JPEG, PNG, or WebP/);
  });

  it("rejects non-images and files over 10 MB before reading them", () => {
    expect(storefrontImageProblem(new File(["x"], "doc.pdf", { type: "application/pdf" }))).toMatch(/image file/);
    expect(storefrontImageProblem({ type: "image/png", size: 11 * 1024 * 1024 } as File)).toMatch(/10 MB/);
    expect(storefrontImageProblem(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
  });
});
