import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NotFound from "@/app/not-found";

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: navigation.back }),
}));

describe("NotFound", () => {
  it("renders the shared Drezivo 404 in the workspace theme", () => {
    render(<NotFound />);

    // Follows the visitor's light/dark choice through the dashboard tokens, never a forced theme.
    expect(screen.getByRole("main").className).toContain("bg-dashboard-canvas");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("Error 404")).toBeTruthy();

    const dashboardLink = screen.getByRole("link", { name: "Back to dashboard" });
    expect(dashboardLink.getAttribute("href")).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(navigation.back).toHaveBeenCalledTimes(1);
  });
});
