import { describe, expect, it } from "vitest";

import { clerkFrontendApiOrigin } from "../../src/lib/clerk-origin";

const key = (host: string, kind = "test") => `pk_${kind}_${btoa(`${host}$`)}`;

describe("clerkFrontendApiOrigin", () => {
  it("reads the Frontend API host from a publishable key", () => {
    expect(clerkFrontendApiOrigin(key("sunny-monarch-898.clerk.accounts.dev"))).toBe("https://sunny-monarch-898.clerk.accounts.dev");
    expect(clerkFrontendApiOrigin(key("clerk.drezivo.shop", "live"))).toBe("https://clerk.drezivo.shop");
  });

  it("returns null for a missing or malformed key", () => {
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
    expect(clerkFrontendApiOrigin("sk_test_abc")).toBeNull();
    expect(clerkFrontendApiOrigin(`pk_test_${btoa("evil.com/x?$")}`)).toBeNull();
    expect(clerkFrontendApiOrigin("pk_test_%%%")).toBeNull();
  });
});
