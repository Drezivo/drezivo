import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/shell/dashboard-shell";

const clerk = vi.hoisted(() => ({
  useClerk: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: clerk.useClerk,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("DashboardShell", () => {
  function openMenu(button: HTMLElement) {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(button, { button: 0, ctrlKey: false });
    fireEvent.click(button);
  }

  beforeEach(() => {
    clerk.useClerk.mockReturnValue({ signOut: vi.fn() });
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
    expect(navigation).toHaveTextContent("Clothing / Inventory");
    expect(navigation).toHaveTextContent("Storefront");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses the desktop navigation from the header trigger", () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    const reservationsLink = screen.getByRole("link", { name: "Reservations" });
    expect(reservationsLink).toHaveTextContent("Reservations");

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));

    expect(reservationsLink).not.toHaveTextContent("Reservations");
  });

  it("defaults to the charcoal and gold dark theme and lets the user switch themes", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    await waitFor(() => expect(document.documentElement.dataset["dashboardTheme"]).toBe("dark"));
    const themeToggle = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset["dashboardTheme"]).toBe("light");
    expect(window.localStorage.getItem("drezivo.dashboard.theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  });

  it("opens notifications and account menus when clicked", async () => {
    render(
      <DashboardShell>
        <div>Shell content</div>
      </DashboardShell>
    );

    openMenu(screen.getByRole("button", { name: "Open notifications" }));
    expect(await screen.findByText("New reservation request")).toBeVisible();

    fireEvent.keyDown(document.body, { key: "Escape" });
    openMenu(screen.getByRole("button", { name: /Luna's Gown Rentals/ }));
    expect(await screen.findByText("My account")).toBeVisible();
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
