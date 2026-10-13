import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { GET } from "../../src/app/api/media/staff/[fileId]/route";

const fileId = "0194f6a2-9dd6-7a4c-8e9f-142f1d310001";
const branchId = "0194f6a2-9dd6-7a4c-8e9f-142f1d310002";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  authMock.mockReset();
});

describe("staff media proxy", () => {
  it("forwards the authenticated branch context and streams only safe response headers", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.example.test");
    authMock.mockResolvedValue({ getToken: async () => "session-token" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("image bytes", {
        status: 200,
        headers: {
          "Content-Type": "image/png; charset=binary",
          "Content-Length": "11",
          "Content-Disposition": "inline",
          "Cache-Control": "public, max-age=3600",
          Location: "https://bucket.r2.cloudflarestorage.com/private/key?X-Amz-Signature=secret",
        },
      })
    );

    const response = await GET(
      new Request(`https://app.example.test/api/media/staff/${fileId}?branch_id=${branchId}`),
      {
        params: Promise.resolve({ fileId }),
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/media/staff/${fileId}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer session-token",
          Accept: "image/avif,image/webp,image/png,image/jpeg,application/pdf",
          "X-Drezivo-Branch-Id": branchId,
        },
        cache: "no-store",
        redirect: "manual",
      }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("location")).toBeNull();

    const body = await response.text();
    expect(body).toBe("image bytes");
    expect(body).not.toMatch(/r2\.cloudflarestorage|X-Amz-Signature|private\/key/i);
  });

  it("rejects invalid IDs before authentication or upstream access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(new Request("https://app.example.test/api/media/staff/not-a-uuid"), {
      params: Promise.resolve({ fileId: "not-a-uuid" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a Clerk session before calling the API", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.example.test");
    authMock.mockResolvedValue({ getToken: async () => null });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(new Request(`https://app.example.test/api/media/staff/${fileId}`), {
      params: Promise.resolve({ fileId }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
