import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReservationsPage } from "@/components/reservations/reservations-page";

describe("ReservationsPage", () => {
  it("keeps reservation details hidden until a table row is opened", () => {
    render(<ReservationsPage />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open reservation R-00148" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText("Reservation #R-00148")).toBeVisible();
    expect(within(dialog).getByText("Maria Santos")).toBeVisible();
    expect(within(dialog).getByText("Black Satin Gown")).toBeVisible();
  });

  it("filters the reservation table from the search input", () => {
    render(<ReservationsPage />);

    fireEvent.change(screen.getByLabelText("Search reservations"), {
      target: { value: "Leanne Cruz" },
    });

    expect(screen.getByText("Leanne Cruz")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });

  it("filters by reservation status tabs", () => {
    render(<ReservationsPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Confirmed (16)" }));

    expect(screen.getByText("Maria Santos")).toBeVisible();
    expect(screen.getByText("Carla Dela Cruz")).toBeVisible();
    expect(screen.queryByText("Anna Reyes")).not.toBeInTheDocument();
  });
});
