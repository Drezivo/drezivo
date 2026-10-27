import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const productId = "00000000-0000-4000-8000-000000000100";
const variantId = "00000000-0000-4000-8000-000000000101";
const updatedAt = "2026-10-10T00:00:00.000Z";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "req-variant-lifecycle" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo catalogue variant lifecycle API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("clerk-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("reactivates a variant through the existing lifecycle endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        variant_id: variantId,
        product_id: productId,
        status: "active",
        outcome: "updated",
        updated_at: updatedAt,
      })
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.updateClothingVariantLifecycle(
      productId,
      variantId,
      { expected_updated_at: updatedAt, status: "active" },
      "variant-restore-intent"
    );

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe(
      `/api/v1/catalogue/clothing/${productId}/variants/${variantId}/lifecycle`
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_updated_at: updatedAt,
      status: "active",
    });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("variant-restore-intent");
    expect(result.data).toMatchObject({ variant_id: variantId, status: "active" });
  });
});
