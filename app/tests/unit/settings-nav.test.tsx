import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsNav } from "@/components/settings/settings-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/account" }));

describe("SettingsNav", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("highlights Profile or Security to match the account page being shown", async () => {
    render(<SettingsNav />);
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Security" })).not.toHaveAttribute("aria-current");

    act(() => screen.getByRole("link", { name: "Security" }).click());

    expect(window.location.hash).toBe("#/security");
    // `hashchange` is dispatched asynchronously, as in a browser.
    await waitFor(() => expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });
});
