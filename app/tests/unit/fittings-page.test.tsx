import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FittingsPage } from "@/components/fittings/fittings-page";

describe("FittingsPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("renders the operational hierarchy with fixture-derived summaries", () => {
    render(<FittingsPage />);

    expect(screen.getByRole("heading", { name: "Fittings" })).toBeVisible();
    expect(screen.getByText("Manage fitting appointments and today's schedule.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule & Availability/ })).toHaveAttribute(
      "href",
      "/fittings/schedule"
    );
    expect(screen.getByRole("button", { name: /New Fitting/ })).toBeEnabled();

    expect(screen.getByText("Today")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
    expect(screen.getByText("Pending review")).toBeVisible();
    expect(screen.getByText("Page 1 · 10 fittings loaded")).toBeVisible();
  });

  it("paginates fitting appointments at 10 rows per page", () => {
    render(<FittingsPage />);

    expect(screen.getAllByRole("button", { name: /Open fitting for/ })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Page 2 · 10 fittings loaded")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Open fitting for/ })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("filters appointments by customer or garment search and clears the filter", () => {
    render(<FittingsPage />);

    fireEvent.change(screen.getByPlaceholderText("Customer or garment..."), {
      target: { value: "Ivory Wedding Gown" },
    });

    expect(screen.getByText("Page 1 · 1 fittings loaded")).toBeVisible();
    expect(screen.getByRole("button", { name: /Open fitting for Bianca Flores/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Page 1 · 10 fittings loaded")).toBeVisible();
  });

  it("supports status and date filters with a distinct empty filtered state", async () => {
    render(<FittingsPage />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Status: All statuses" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Completed" }));
    expect(screen.getByText("Page 1 · 3 fittings loaded")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Date: All dates" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "No fittings match these filters" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Page 1 · 10 fittings loaded")).toBeVisible();
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

  it("opens the fitting details sheet with customer, garment, payment, and guarantee details", () => {
    render(<FittingsPage />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Open fitting for Ari dela Rosa on Sep 26, 2026/,
      })
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Fitting Details")).toBeVisible();
    expect(within(dialog).getByText("Ari dela Rosa")).toBeVisible();
    expect(within(dialog).getByText("ari@example.test")).toBeVisible();
    expect(within(dialog).getByText("0917 000 0001")).toBeVisible();
    expect(within(dialog).getByText("Emerald Evening Gown")).toBeVisible();
    expect(within(dialog).getByText("Guaranteed garment")).toBeVisible();
    expect(within(dialog).getByText("Asset PROTO-GWN-0042")).toBeVisible();
    expect(within(dialog).getAllByText("Verified").length).toBeGreaterThan(0);
    expect(
      within(dialog).getByText(/does not change the appointment status automatically/i)
    ).toBeVisible();
  });

  it("keeps preference-only garments distinct and supports guarded local prototype actions", () => {
    render(<FittingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Open fitting for Bianca Flores/ }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Preference only")).toBeVisible();
    expect(within(dialog).queryByText(/Asset PROTO-/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm fitting" }));
    expect(within(dialog).getAllByText("Confirmed").length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Mark no-show" }));
    expect(within(dialog).getByText(/Mark this fitting as no-show\?/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep current status" }));
    expect(within(dialog).queryByText(/Mark this fitting as no-show\?/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Mark no-show" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("No-show").length).toBeGreaterThan(0);
  });

  it("uses the schedule default duration when opening New Fitting", () => {
    window.sessionStorage.setItem("drezivo:fittings:prototype-default-duration", "45");
    render(<FittingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Fitting" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Fitting duration")).toHaveValue("45");
  });

  it("creates one local fitting through the three-step prototype flow", () => {
    render(<FittingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Fitting" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Local prototype only. Changes are not saved.")).toBeVisible();

    fireEvent.change(within(dialog).getByPlaceholderText("Name, email, or phone..."), {
      target: { value: "Bianca" },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Bianca Flores/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Ivory Wedding Gown" }));
    fireEvent.change(within(dialog).getByLabelText("Garment intent"), {
      target: { value: "Guaranteed intent" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Bianca Flores")).toBeVisible();
    expect(within(dialog).getByText("Ivory Wedding Gown")).toBeVisible();
    expect(within(dialog).getByText("Guaranteed intent")).toBeVisible();
    expect(within(dialog).getByText("₱300")).toBeVisible();

    const createButton = within(dialog).getByRole("button", { name: "Create local fitting" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(screen.getByText("Page 1 · 10 fittings loaded")).toBeVisible();
    const details = screen.getByRole("dialog");
    expect(within(details).getByText("Guaranteed intent")).toBeVisible();
    expect(within(details).queryByText(/Asset PROTO-LOCAL/)).not.toBeInTheDocument();
  });

  it("supports a minimal walk-in customer and no-fee fitting", () => {
    render(<FittingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Fitting" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Walk-in customer" }));
    fireEvent.change(within(dialog).getByPlaceholderText("Full name"), {
      target: { value: "Local Walk-in" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Classic Barong" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "This fitting has a fee" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Local Walk-in")).toBeVisible();
    expect(within(dialog).getByText("No fee")).toBeVisible();
    expect(within(dialog).getByText("Not required")).toBeVisible();
  });

  it("exposes keyboard-friendly names for filters, pagination, and the new fitting flow", () => {
    render(<FittingsPage />);

    expect(screen.getByRole("textbox", { name: "Search fittings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Status: All statuses" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Date: All dates" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Fittings pagination" })).toBeVisible();
    expect(screen.getByLabelText("Page 1 of 2")).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "New Fitting" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("group", { name: "Customer type" })).toBeVisible();
    expect(within(dialog).getByRole("radiogroup", { name: "Existing customers" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeVisible();
  });

  it("distinguishes first-use empty, loading, and retryable error states", () => {
    const emptyView = render(<FittingsPage appointments={[]} />);
    expect(screen.getByRole("heading", { name: "No fitting appointments yet" })).toBeVisible();
    emptyView.unmount();

    const loadingView = render(<FittingsPage initialViewState="loading" />);
    expect(screen.getByRole("status", { name: "Loading fittings" })).toBeVisible();
    expect(screen.queryByText(/Page \d+ · \d+ fittings loaded/)).not.toBeInTheDocument();
    loadingView.unmount();

    render(<FittingsPage initialViewState="error" />);
    expect(
      screen.getByRole("heading", { name: "Could not load fitting appointments" })
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("list", { name: "Fitting appointments" })).toBeVisible();
  });
});
