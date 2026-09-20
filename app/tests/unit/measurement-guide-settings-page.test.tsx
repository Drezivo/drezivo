import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MeasurementGuideProvider, useMeasurementGuide } from "@/components/settings/measurement-guide-context";
import { MeasurementGuideSettingsPage } from "@/components/settings/measurement-guide-settings-page";

function GuideProbe() {
  const { guide } = useMeasurementGuide();
  return <span data-testid="guide-name">{guide.name}</span>;
}

describe("MeasurementGuideSettingsPage", () => {
  it("updates the shared default guide name used by the dashboard workflow", () => {
    render(
      <MeasurementGuideProvider>
        <MeasurementGuideSettingsPage />
        <GuideProbe />
      </MeasurementGuideProvider>
    );

    fireEvent.change(screen.getByLabelText("Guide Name"), {
      target: { value: "Standard Formalwear Guide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Default Guide" }));

    expect(screen.getByTestId("guide-name")).toHaveTextContent("Standard Formalwear Guide");
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
  });
});
