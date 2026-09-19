import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingStatusPanel } from "@/components/onboarding/onboarding-status-panel";
import { OnboardingStatusPage } from "@/components/onboarding/onboarding-status-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
}));

describe("OnboardingStatusPanel", () => {
  it("renders the onboarding progress and status checks", () => {
    render(<OnboardingStatusPanel />);

    expect(screen.getByRole("heading", { name: "Setting up your workspace" })).toBeVisible();
    expect(screen.getByText("We're checking your onboarding progress and preparing")).toBeVisible();
    expect(screen.getByText("the next step for your business.")).toBeVisible();

    expect(screen.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
    expect(screen.getByText("Organization")).toBeVisible();
    expect(screen.getByText("Plan")).toBeVisible();
    expect(screen.getByText("Launch")).toBeVisible();

    expect(screen.getByText("Checking organization setup")).toBeVisible();
    expect(screen.getByText("Checking plan selection")).toBeVisible();
    expect(screen.getByText("Preparing workspace access")).toBeVisible();
  });

  it("provides a refresh destination and visible support copy", () => {
    render(<OnboardingStatusPanel />);

    expect(screen.getByRole("link", { name: "Refresh status" })).toHaveAttribute(
      "href",
      "/onboarding"
    );
    expect(screen.getByText("Need help?")).toBeVisible();
    expect(screen.getByText("Contact support")).toBeVisible();
  });

  it("links the back control to sign-up", () => {
    render(<OnboardingStatusPage />);

    expect(screen.getByRole("link", { name: "Back to sign up" })).toHaveAttribute(
      "href",
      "/sign-up"
    );
  });
});
