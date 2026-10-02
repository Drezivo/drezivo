import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/shell/dashboard-shell";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
  useUser: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getStorefront: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
  useClerk: clerk.useClerk,
  useUser: clerk.useUser,
}));

vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => api,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  // The shell mounts the pending-hold guard, which navigates with the router.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("DashboardShell", () => {
  function openMenu(button: HTMLElement) {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(button, { button: 0, ctrlKey: false });
    fireEvent.click(button);
  }

  beforeEach(() => {
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    clerk.useClerk.mockReturnValue({ signOut: vi.fn() });
    clerk.useUser.mockReturnValue({
      user: {
        firstName: "Ryanny",
        fullName: "Ryanny Romero",
        imageUrl: "https://img.example.test/user.png",
        lastName: "Romero",
        primaryEmailAddress: { emailAddress: "ryanny@example.test" },
      },
    });
    api.getActorContext.mockResolvedValue({
      data: {
        tenant: { name: "Romero Formalwear" },
        membership: { role: "owner" },
      },
      requestId: "req-actor",
    });
    api.getStorefront.mockResolvedValue({
      data: {
        media: { logo_url: "https://img.example.test/store-logo.png" },
      },
      requestId: "req-storefront",
    });
    window.localStorage.clear();
    delete document.documentElement.dataset["dashboardTheme"];
  });

  it("renders the reference navigation with Dashboard active", () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(navigation).toHaveTextContent("Dashboard");
    expect(navigation).toHaveTextContent("Reservations");
    expect(navigation).toHaveTextContent("Clothing");
    expect(navigation).toHaveTextContent("Storefront");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses the desktop navigation from the header trigger", () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    // The phone tab bar also links to Reservations; this test is about the sidebar.
    const sidebar = screen.getByRole("navigation", { name: "Primary" });
    const reservationsLink = within(sidebar).getByRole("link", { name: "Reservations" });
    expect(reservationsLink).toHaveTextContent("Reservations");

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));

    expect(reservationsLink).not.toHaveTextContent("Reservations");
  });

  it("follows the system theme by default and remembers the user's switch", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    // jsdom has no prefers-color-scheme, so "system" resolves to light.
    const themeToggle = await screen.findByRole("button", { name: "Switch to dark theme" });
    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset["dashboardTheme"]).toBe("dark");
    expect(window.localStorage.getItem("drezivo-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  });

  it("keeps the personal account menu separate from the business workspace menu", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    openMenu(screen.getByRole("button", { name: "Open account menu" }));
    expect(await screen.findByRole("menuitem", { name: "Your profile" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Password and security" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Match system" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();

    fireEvent.keyDown(document.body, { key: "Escape" });
    openMenu(await screen.findByRole("button", { name: "Open Romero Formalwear menu" }));
    expect(await screen.findByRole("menuitem", { name: "Business information" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("menuitem", { name: "Payment methods" })).toHaveAttribute("href", "/settings/payment-methods");
  });

  it("shows the active business, signed-in user, resolved role, and saved business logo", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    expect(await screen.findByText("Romero Formalwear")).toBeVisible();
    expect(screen.getByText("Ryanny Romero")).toBeVisible();
    expect(screen.getByText("ryanny@example.test")).toBeVisible();
    expect(await screen.findByRole("img", { name: "Romero Formalwear logo" })).toHaveAttribute(
      "src",
      "https://img.example.test/store-logo.png"
    );
  });

  it("updates the sidebar logo when storefront branding is saved", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    expect(await screen.findByRole("img", { name: "Romero Formalwear logo" })).toHaveAttribute(
      "src",
      "https://img.example.test/store-logo.png"
    );

    window.dispatchEvent(
      new CustomEvent("drezivo:storefront-updated", {
        detail: { logoUrl: "https://img.example.test/new-logo.png" },
      })
    );

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Romero Formalwear logo" })).toHaveAttribute(
        "src",
        "https://img.example.test/new-logo.png"
      )
    );
  });

  it("offers phone tabs and a Menu sheet with the remaining pages", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    const tabs = screen.getByRole("navigation", { name: "Quick navigation" });
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(tabs).getByRole("button", { name: "Menu" }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
    expect(within(sheet).getByRole("link", { name: "Help Center" })).toHaveAttribute("href", "/help");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset["dashboardTheme"]).toBe("dark");
    expect(within(sheet).getByRole("button", { name: /Sign out/ })).toBeVisible();
  });

  it("opens the navigation as a Sheet on mobile", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(screen.getByRole("dialog")).toHaveTextContent("Reservations");

    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });
});
