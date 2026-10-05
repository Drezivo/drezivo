import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsNav } from "@/components/settings/settings-nav";

const actor = vi.hoisted(() => ({ role: "owner" as "owner" | "frontdesk" }));

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/account" }));
vi.mock("@/components/shell/dashboard-access-gate", () => ({
  useVerifiedActorContext: () => ({ membership: { role: actor.role } }),
}));

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
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });

  it("shows Members to Owners and hides it from Front Desk users", () => {
    actor.role = "owner";
    const { unmount } = render(<SettingsNav />);
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/settings/members"
    );
    unmount();

    actor.role = "frontdesk";
    render(<SettingsNav />);
    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  });
});
