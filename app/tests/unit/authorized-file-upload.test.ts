import { afterEach, describe, expect, it, vi } from "vitest";

import { fileObjectId, type UploadAuthorizationResponse } from "@drezivo/contracts";

import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";

const authorization: UploadAuthorizationResponse = {
  file_id: fileObjectId.parse("0194f6a2-9dd6-7a4c-8e9f-142f1d310001"),
  upload_url: "https://uploads.example.test/file",
  upload_method: "PUT",
  required_headers: { "Content-Type": "image/png", "If-None-Match": "*" },
  expires_at: "2026-09-30T06:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("uploadAuthorizedFile", () => {
  it("sends the API-provided method and headers verbatim", async () => {
    const file = new Blob(["image"], { type: "image/png" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await uploadAuthorizedFile(authorization, file, "upload failed");

    expect(fetchMock).toHaveBeenCalledWith(authorization.upload_url, {
      method: "PUT",
      headers: authorization.required_headers,
      body: file,
    });
  });

  it("allows a create-only 412 response to proceed to server finalization", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 412 }));

    await expect(
      uploadAuthorizedFile(authorization, new Blob(["image"]), "upload failed")
    ).resolves.toBeUndefined();
  });

  it("rejects other storage failures with the caller-safe message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      uploadAuthorizedFile(authorization, new Blob(["image"]), "safe upload failure")
    ).rejects.toThrow("safe upload failure");
  });

  it("normalizes transport errors without exposing provider details", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("private signed URL detail"));

    await expect(
      uploadAuthorizedFile(authorization, new Blob(["image"]), "safe upload failure")
    ).rejects.toThrow("safe upload failure");
  });
});
