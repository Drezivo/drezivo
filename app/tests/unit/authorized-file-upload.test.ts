import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAuthorizationResponse } from "@drezivo/contracts";

import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";

describe("uploadAuthorizedFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the upload method and every required header unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["synthetic upload"], "sample.png", { type: "image/png" });
    const authorization = uploadAuthorizationResponse.parse({
      file_id: "00000000-0000-4000-8000-000000000001",
      upload_url: "https://uploads.example.test/synthetic",
      upload_method: "PUT" as const,
      required_headers: {
        "Content-Type": "image/png",
        "If-None-Match": "*",
        "X-Provider-Extension": "signed-value",
      },
      expires_at: "2026-09-29T00:00:00.000Z",
    });

    await expect(
      uploadAuthorizedFile(authorization, file, "Upload failed.")
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(authorization.upload_url, {
      method: "PUT",
      headers: authorization.required_headers,
      body: file,
    });
  });

  it("rejects a failed direct upload with the caller's safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const authorization = uploadAuthorizationResponse.parse({
      file_id: "00000000-0000-4000-8000-000000000001",
      upload_url: "https://uploads.example.test/synthetic",
      upload_method: "PUT" as const,
      required_headers: { "Content-Type": "application/pdf" },
      expires_at: "2026-09-29T00:00:00.000Z",
    });

    await expect(
      uploadAuthorizedFile(
        authorization,
        new File(["synthetic upload"], "receipt.pdf", { type: "application/pdf" }),
        "The receipt upload did not finish successfully."
      )
    ).rejects.toThrow("The receipt upload did not finish successfully.");
  });

  it("replaces transport errors with the caller's safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("private provider detail")));
    const authorization = uploadAuthorizationResponse.parse({
      file_id: "00000000-0000-4000-8000-000000000001",
      upload_url: "https://uploads.example.test/synthetic",
      upload_method: "PUT" as const,
      required_headers: { "Content-Type": "application/pdf", "If-None-Match": "*" },
      expires_at: "2026-09-29T00:00:00.000Z",
    });

    await expect(
      uploadAuthorizedFile(
        authorization,
        new File(["synthetic upload"], "receipt.pdf", { type: "application/pdf" }),
        "The receipt upload did not finish successfully."
      )
    ).rejects.toThrow("The receipt upload did not finish successfully.");
  });
});
