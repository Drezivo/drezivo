import { describe, expect, it } from "vitest";

import { resolveStaffSiteOrigin } from "@/lib/staff-site-origin";

describe("staff social metadata origin", () => {
  it("uses an explicit origin when configured", () => {
    expect(resolveStaffSiteOrigin({ NEXT_PUBLIC_PARTNERS_URL: "https://example.test", VERCEL_ENV: "preview" })).toBe("https://example.test");
  });

  it("uses the stable staging hostname", () => {
    expect(resolveStaffSiteOrigin({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging", VERCEL_URL: "branch.vercel.app" })).toBe("https://app-preview.drezivo.shop");
  });

  it("uses the deployment hostname for other preview branches", () => {
    expect(resolveStaffSiteOrigin({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature", VERCEL_URL: "branch.vercel.app" })).toBe("https://branch.vercel.app");
  });

  it("uses production and local defaults", () => {
    expect(resolveStaffSiteOrigin({ NODE_ENV: "production" })).toBe("https://partners.drezivo.shop");
    expect(resolveStaffSiteOrigin({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });
});
