import { describe, expect, it } from "vitest";

import type { ProductId, ProductVariantId } from "@drezivo/contracts";

import { additionalGarmentsReadiness, type AdditionalGarment } from "@/components/reservations/additional-garments";

const MAIN = "00000000-0000-4000-8000-000000000001" as ProductVariantId;
const OTHER = "00000000-0000-4000-8000-000000000002" as ProductVariantId;
const DATES = "2026-10-17T02:00:00.000Z|2026-10-20T02:00:00.000Z";

function garment(overrides: Partial<AdditionalGarment>): AdditionalGarment {
  return {
    key: "g1",
    productId: "00000000-0000-4000-8000-000000000010" as ProductId,
    name: "Amara",
    imageUrl: null,
    detail: null,
    variantId: OTHER,
    availableAssets: 1,
    checkedFor: DATES,
    error: null,
    ...overrides,
  };
}

describe("additionalGarmentsReadiness", () => {
  it("is ready with no extra garments", () => {
    expect(additionalGarmentsReadiness([], MAIN, DATES)).toEqual({ ready: true, variantIds: [], problem: null });
  });

  it("returns the extra sizes in order once each is checked for the booking dates", () => {
    expect(additionalGarmentsReadiness([garment({})], MAIN, DATES)).toEqual({ ready: true, variantIds: [OTHER], problem: null });
  });

  it("waits for a size and for a check of the current dates", () => {
    expect(additionalGarmentsReadiness([garment({ variantId: "" })], MAIN, DATES).problem).toBe("Choose a size for Amara.");
    expect(additionalGarmentsReadiness([garment({ checkedFor: "older|dates" })], MAIN, DATES).problem).toBe("Checking Amara for these dates…");
  });

  it("counts the main garment when the same size is added again", () => {
    const twice = garment({ variantId: MAIN, name: "Celestine", availableAssets: 1 });
    expect(additionalGarmentsReadiness([twice], MAIN, DATES)).toMatchObject({
      ready: false,
      problem: "Only 1 Celestine in this size is free for these dates.",
    });
    expect(additionalGarmentsReadiness([{ ...twice, availableAssets: 2 }], MAIN, DATES).ready).toBe(true);
  });

  it("reports a garment with no free piece", () => {
    expect(additionalGarmentsReadiness([garment({ availableAssets: 0 })], MAIN, DATES).problem).toBe("Amara is not free for these dates.");
  });
});
