import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerSuggestions } from "@/components/reservations/customer-suggestions";

const api = vi.hoisted(() => ({ search: vi.fn(), getToken: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: api.getToken }) }));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({ getStaffReservationIntakeOptions: api.search }),
}));
const customer = { id: "00000000-0000-4000-8000-000000000001", full_name: "Maria Santos", phone: "09171234567", email: "maria@example.test" };

describe("reservation customer suggestions", () => {
  beforeEach(() => { api.search.mockReset(); });

  it("requires an explicit selection of a matching customer", async () => {
    api.search.mockResolvedValue({ data: { customers: [customer] } });
    const select = vi.fn();
    render(<CustomerSuggestions name="Maria" onSelect={select} />);
    const option = await screen.findByRole("button", { name: /Maria Santos/ });
    expect(select).not.toHaveBeenCalled();
    expect(option).toHaveTextContent("09171234567");
    fireEvent.click(option);
    expect(select).toHaveBeenCalledWith(customer);
  });

  it("shows only the first five matching customers and allows selecting one", async () => {
    const customers = Array.from({ length: 8 }, (_, index) => ({
      ...customer,
      id: `customer-${index + 1}`,
      full_name: `John ${index + 1}`,
    }));
    api.search.mockResolvedValue({ data: { customers } });
    const select = vi.fn();
    render(<CustomerSuggestions name="John" onSelect={select} />);

    expect(await screen.findAllByRole("button")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /John 6/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /John 5/ }));
    expect(select).toHaveBeenCalledWith(customers[4]);
  });

  it("allows a new customer when no matches exist or lookup fails", async () => {
    api.search.mockResolvedValueOnce({ data: { customers: [] } });
    const { unmount } = render(<CustomerSuggestions name="Unknown" onSelect={vi.fn()} />);
    expect(await screen.findByText(/No matching customers/)).toBeVisible();
    unmount();
    api.search.mockRejectedValueOnce(new Error("offline"));
    render(<CustomerSuggestions name="Another" onSelect={vi.fn()} />);
    expect(await screen.findByText(/still enter a new customer/)).toBeVisible();
  });

  it("does not search for short names and ignores a stale response", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    api.search.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ data: { customers: [] } });
    const { rerender } = render(<CustomerSuggestions name="M" onSelect={vi.fn()} />);
    expect(api.search).not.toHaveBeenCalled();
    rerender(<CustomerSuggestions name="Maria" onSelect={vi.fn()} />);
    await waitFor(() => expect(api.search).toHaveBeenCalled());
    rerender(<CustomerSuggestions name="Other" onSelect={vi.fn()} />);
    resolveOld({ data: { customers: [customer] } });
    expect(await screen.findByText(/No matching customers/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Maria Santos/ })).not.toBeInTheDocument();
  });
});
