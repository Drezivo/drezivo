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
  it("renders the dedicated dark dashboard 404 experience", () => {
    render(<NotFound />);

    expect(screen.getByRole("main").className).toContain("dashboard-theme-dark");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("ERROR 404")).toBeTruthy();

    const dashboardLink = screen.getByRole("link", { name: "Back to dashboard" });
    expect(dashboardLink.getAttribute("href")).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(navigation.back).toHaveBeenCalledTimes(1);
  });
});
