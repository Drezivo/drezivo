import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberResolvedWorkspace, takeResolvedWorkspace } from "@/lib/workspace-handoff";

describe("workspace hand-off", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("lets the gate skip resolution once, for the same organization only", () => {
    rememberResolvedWorkspace("org_a");
    expect(takeResolvedWorkspace("org_a")).toBe(true);
    expect(takeResolvedWorkspace("org_a")).toBe(false);
  });

  it("ignores a note for another organization and still consumes it", () => {
    rememberResolvedWorkspace("org_a");
    expect(takeResolvedWorkspace("org_b")).toBe(false);
    expect(takeResolvedWorkspace("org_a")).toBe(false);
  });

  it("ignores a note older than a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
    rememberResolvedWorkspace("org_a");
    vi.setSystemTime(new Date("2026-10-15T10:01:01Z"));
    expect(takeResolvedWorkspace("org_a")).toBe(false);
  });

  it("falls back to a full resolution when there is no active organization or storage fails", () => {
    rememberResolvedWorkspace("org_a");
    expect(takeResolvedWorkspace(null)).toBe(false);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(takeResolvedWorkspace("org_a")).toBe(false);
  });

  it("rejects a malformed note", () => {
    sessionStorage.setItem("drezivo:workspace-resolved", "{not json");
    expect(takeResolvedWorkspace("org_a")).toBe(false);
    sessionStorage.setItem("drezivo:workspace-resolved", JSON.stringify({ clerkOrgId: "org_a", at: "now" }));
    expect(takeResolvedWorkspace("org_a")).toBe(false);
  });
});
