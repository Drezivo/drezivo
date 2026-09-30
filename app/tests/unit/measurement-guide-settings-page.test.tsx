import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeasurementGuideSettingsPage } from "@/components/settings/measurement-guide-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({ getDefaultMeasurementGuide: vi.fn(), saveMeasurementGuide: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {},
  createDrezivoApiClient: () => api,
}));

const FILE_ID = "00000000-0000-4000-8000-000000000098";
const guide = (name: string) => ({
  id: "00000000-0000-4000-8000-000000000099",
  file_id: FILE_ID,
  name,
  image_url: null,
  is_default: true,
  status: "active",
  created_at: "2026-09-21T00:00:00.000Z",
  updated_at: "2026-09-21T00:00:00.000Z",
});

describe("MeasurementGuideSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
  });

  it("starts empty for a workspace without a guide, with nothing to save", async () => {
    api.getDefaultMeasurementGuide.mockResolvedValue({ data: { guide: null } });
    render(<MeasurementGuideSettingsPage />);

    expect(await screen.findByLabelText("Guide name")).toHaveValue("");
    expect(screen.queryByText(/Luna/)).toBeNull();
    expect(screen.getByRole("button", { name: /Save guide/ })).toBeDisabled();
  });

  it("renames the saved guide once, keeping its image, even when Save is clicked twice", async () => {
    api.getDefaultMeasurementGuide.mockResolvedValue({ data: { guide: guide("Vergel's size guide") } });
    api.saveMeasurementGuide.mockResolvedValue({ data: guide("Suit size guide") });
    render(<MeasurementGuideSettingsPage />);

    fireEvent.change(await screen.findByLabelText("Guide name"), { target: { value: "Suit size guide" } });
    api.getDefaultMeasurementGuide.mockResolvedValue({ data: { guide: guide("Suit size guide") } });
    const save = screen.getByRole("button", { name: /Save changes/ });
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByText("Saved");
    expect(api.saveMeasurementGuide).toHaveBeenCalledTimes(1);
    expect(api.saveMeasurementGuide).toHaveBeenCalledWith({ name: "Suit size guide", file_id: FILE_ID, make_default: true }, expect.any(String));
    await waitFor(() => expect(screen.getByLabelText("Guide name")).toHaveValue("Suit size guide"));
  });
});
