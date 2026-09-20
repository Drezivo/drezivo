import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddClothingPage } from "@/components/inventory/add-clothing-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getCatalogueCategories: vi.fn(),
  getDefaultMeasurementGuide: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {},
  createDrezivoApiClient: () => api,
}));

vi.mock("@/components/settings/measurement-guide-context", () => ({
  useMeasurementGuide: () => ({
    guide: {
      id: "00000000-0000-4000-8000-000000000099",
      name: "Default Size Guide",
      previewUrl: null,
    },
  }),
}));

describe("AddClothingPage categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getDefaultMeasurementGuide.mockResolvedValue({
      data: {
        guide: {
          id: "00000000-0000-4000-8000-000000000099",
          file_id: "00000000-0000-4000-8000-000000000098",
          name: "Default Size Guide",
          status: "active",
          is_default: true,
          created_at: "2026-09-21T00:00:00.000Z",
          updated_at: "2026-09-21T00:00:00.000Z",
        },
      },
      requestId: "req-guide",
    });
    api.getCatalogueCategories.mockResolvedValue({
      data: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Gowns",
            status: "active",
            display_order: 10,
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            name: "Dresses",
            status: "active",
            display_order: 20,
          },
          {
            id: "00000000-0000-4000-8000-000000000003",
            name: "Costumes",
            status: "inactive",
            display_order: 50,
          },
        ],
      },
      requestId: "req-categories",
    });
  });

  it("loads tenant categories and excludes inactive categories from the Add Clothing picker", async () => {
    render(<AddClothingPage />);

    const selected = await screen.findByText("Gowns");
    const trigger = selected.closest("button");
    if (!trigger) throw new Error("Expected selected category to be rendered inside a button.");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByRole("menuitem", { name: "Gowns" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Dresses" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Costumes" })).not.toBeInTheDocument();
  });
});
