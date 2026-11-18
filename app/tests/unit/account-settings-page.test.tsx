import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsPage } from "@/components/settings/account-settings-page";

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), getActorContext: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
  UserProfile: () => <div data-testid="clerk-profile" />,
}));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({ getActorContext: mocks.getActorContext }),
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));

describe("account settings", () => {
  afterEach(() => { window.location.hash = ""; });

  it("shows the deletion support contact on Security but not Profile", () => {
    mocks.getActorContext.mockResolvedValue({ data: { tenant: { name: "Test" }, membership: { role: "owner" } } });
    render(<AccountSettingsPage />);
    expect(screen.getByTestId("clerk-profile")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Delete account" })).not.toBeInTheDocument();

    act(() => {
      window.location.hash = "#/security";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "drezivoshop@gmail.com" })).toHaveAttribute("href", "mailto:drezivoshop@gmail.com");
    expect(screen.getByTestId("clerk-profile")).toBeInTheDocument();

    act(() => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.queryByRole("heading", { name: "Delete account" })).not.toBeInTheDocument();
  });
});
