import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MonthPickerField } from "@/components/ui/month-picker-field";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("MonthPickerField", () => {
  it("navigates years and selects a month from the anchored picker", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MonthPickerField
        id="start-month"
        label="Start month"
        value=""
        defaultYear={2026}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start month" }));
    const dialog = screen.getByRole("dialog", { name: "Select start month" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next year" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "October 2027" }));

    expect(onChange).toHaveBeenCalledWith("2027-10");
    rerender(
      <MonthPickerField
        id="start-month"
        label="Start month"
        value="2027-10"
        defaultYear={2026}
        onChange={onChange}
      />
    );
    expect(screen.getByRole("button", { name: "Start month" })).toHaveTextContent(
      "October 2027"
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as a bottom sheet on phones and selects a month", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const onChange = vi.fn();
    render(
      <MonthPickerField
        id="start-month"
        label="Start month"
        value=""
        defaultYear={2026}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start month" }));
    const dialog = await screen.findByRole("dialog", { name: "Select start month" });
    expect(dialog).toHaveAttribute("data-side", "bottom");
    fireEvent.click(within(dialog).getByRole("button", { name: "September 2026" }));

    expect(onChange).toHaveBeenCalledWith("2026-09");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
