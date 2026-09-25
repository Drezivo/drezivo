import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FittingsPage } from "@/components/fittings/fittings-page";

describe("FittingsPage", () => {
  it("renders the operational hierarchy with fixture-derived summaries", () => {
    render(<FittingsPage />);

    expect(screen.getByRole("heading", { name: "Fittings" })).toBeVisible();
    expect(screen.getByText("Manage fitting appointments and today's schedule.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule & Availability/ })).toHaveAttribute(
      "href",
      "/fittings/schedule"
    );
    expect(screen.getByRole("button", { name: /New Fitting/ })).toBeDisabled();

    expect(screen.getByText("Today")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
    expect(screen.getByText("Pending review")).toBeVisible();
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });

  it("filters appointments by customer or garment search and clears the filter", () => {
    render(<FittingsPage />);

    fireEvent.change(screen.getByPlaceholderText("Customer or garment..."), {
      target: { value: "Ivory Wedding Gown" },
    });

    expect(screen.getByText("Showing 1 of 6 appointments")).toBeVisible();
    expect(screen.getByRole("button", { name: /Open fitting for Bianca Flores/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });

  it("supports status and date filters with a distinct empty filtered state", async () => {
    render(<FittingsPage />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "All statuses" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Completed" }));
    expect(screen.getByText("Showing 1 of 6 appointments")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "All dates" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "No fittings match these filters" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });

  it("shows date, customer, garment, payment, status, and attention without resource fields", () => {
    render(<FittingsPage />);

    const biancaRow = screen.getByRole("button", {
      name: /Open fitting for Bianca Flores on Sep 26, 2026/,
    });

    expect(within(biancaRow).getByText("Bianca Flores")).toBeVisible();
    expect(within(biancaRow).getByText("Ivory Wedding Gown")).toBeVisible();
    expect(within(biancaRow).getByText("Small / Ivory")).toBeVisible();
    expect(within(biancaRow).getByText("₱300")).toBeVisible();
    expect(within(biancaRow).getByText("Pending")).toBeVisible();
    expect(within(biancaRow).getByText("Pending review")).toBeVisible();
    expect(within(biancaRow).getByText("Payment review")).toBeVisible();
    expect(within(biancaRow).getByText("Preference only")).toBeVisible();
    expect(screen.queryByText(/Fitting Room/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fitting Staff/i)).not.toBeInTheDocument();
  });

  it("opens the fitting details preview sheet from an appointment row", () => {
    render(<FittingsPage />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Open fitting for Ari dela Rosa on Sep 26, 2026/,
      })
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Fitting Details")).toBeVisible();
    expect(within(dialog).getByText(/Ari dela Rosa · Sep 26, 2026/)).toBeVisible();
    expect(within(dialog).getByText("Ari dela Rosa")).toBeVisible();
    expect(within(dialog).getByText("Emerald Evening Gown")).toBeVisible();
    expect(within(dialog).getByText("Confirmed")).toBeVisible();
    expect(within(dialog).getByText("Verified")).toBeVisible();
  });

  it("distinguishes first-use empty, loading, and retryable error states", () => {
    const emptyView = render(<FittingsPage appointments={[]} />);
    expect(screen.getByRole("heading", { name: "No fitting appointments yet" })).toBeVisible();
    emptyView.unmount();

    const loadingView = render(<FittingsPage initialViewState="loading" />);
    expect(screen.getByRole("status", { name: "Loading fittings" })).toBeVisible();
    expect(screen.queryByText(/Showing \d+ of \d+ appointments/)).not.toBeInTheDocument();
    loadingView.unmount();

    render(<FittingsPage initialViewState="error" />);
    expect(
      screen.getByRole("heading", { name: "Could not load fitting appointments" })
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("list", { name: "Fitting appointments" })).toBeVisible();
  });
});
