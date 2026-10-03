import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reservationDetail, type PermissionCode, type ReservationDetail } from "@drezivo/contracts";

import { ReservationMutationActions } from "@/components/reservations/reservation-mutation-actions";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  cancelReservation: vi.fn(),
  completeRentalReservation: vi.fn(),
  completeStaffReservation: vi.fn(),
  confirmReservation: vi.fn(),
  getStaffReservationIntakeOptions: vi.fn(),
  getReservationPaymentReceipts: vi.fn(),
  verifyReservationPayment: vi.fn(),
  inspectReservationReturn: vi.fn(),
  pickupReservation: vi.fn(),
  rejectReservation: vi.fn(),
  returnReservation: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    requestId: string | null;
    status: number;

    constructor(
      message: string,
      options: { code?: string; requestId?: string | null; status?: number } = {}
    ) {
      super(message);
      this.name = "DrezivoApiError";
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const permissions: PermissionCode[] = [
  "reservations.manage",
  "reservations.custody",
  "assets.manage",
  "payments.manage",
  "evidence.verify",
];

const confirmedDetail = reservationDetail.parse({
  id: "00000000-0000-4000-8000-000000000101",
  reference_code: "RSV-ACTION-001",
  status: "confirmed",
  branch_id: "00000000-0000-4000-8000-000000000201",
  storefront_id: "00000000-0000-4000-8000-000000000301",
  customer: {
    customer_id: "00000000-0000-4000-8000-000000000102",
    snapshot: { full_name: "Action Customer", phone: "09171234567", email: null, address: "123 Test Street" },
  },
  lines: [
    {
      id: "00000000-0000-4000-8000-000000000103",
      variant_id: "00000000-0000-4000-8000-000000000104",
      variant: { sku: "ACTION-M-EMERALD", size_label: "Medium", color_label: "Emerald", image_url: null },
      current_asset_readiness: "ready",
      line_number: 1,
      name_snapshot: "Action Gown",
      measurements_snapshot: {},
      pricing_snapshot: { rental_minor: "150000", deposit_minor: "50000", currency: "PHP" },
    },
  ],
  pickup_at: "2026-10-12T02:00:00.000Z",
  due_at: "2026-10-14T02:00:00.000Z",
  timezone_snapshot: "Asia/Manila",
  delivery_snapshot: { fulfillment_method: "pickup" },
  price_snapshot: {
    rental_total_minor: "150000",
    security_required_minor: "50000",
    due_now_minor: "200000",
    currency: "PHP",
  },
  payment: {
    id: "00000000-0000-4000-8000-000000000105",
    payment_method_id: "00000000-0000-4000-8000-000000000106",
    method_name: "Cash",
    rail: "cash",
    status: "paid",
    evidence_status: "verified",
    amount_minor: "200000",
    currency: "PHP",
    verified_at: "2026-10-10T03:00:00.000Z",
  },
  hold_acquired_at: "2026-10-10T02:00:00.000Z",
  hold_expires_at: null,
  terms_accepted_at: "2026-10-10T02:02:00.000Z",
  submitted_at: "2026-10-10T02:03:00.000Z",
  confirmed_at: "2026-10-10T03:01:00.000Z",
  completed_at: null,
  custody_timeline: [],
  version: 3,
  created_at: "2026-10-10T02:00:00.000Z",
});

function renderActions(
  detail: ReservationDetail = confirmedDetail,
  permissionCodes: PermissionCode[] = permissions
) {
  const onMutationSuccess = vi.fn();
  const onNotice = vi.fn();
  const onRefreshRequired = vi.fn();
  render(
    <ReservationMutationActions
      detail={detail}
      permissionCodes={permissionCodes}
      onMutationSuccess={onMutationSuccess}
      onNotice={onNotice}
      onRefreshRequired={onRefreshRequired}
    />
  );
  return { onMutationSuccess, onNotice, onRefreshRequired };
}

function mutationResult(status: string, version = 4) {
  return {
    data: {
      reservation: {
        id: confirmedDetail.id,
        reference_code: confirmedDetail.reference_code,
        status,
        branch_id: confirmedDetail.branch_id,
        storefront_id: confirmedDetail.storefront_id,
        variant_id: confirmedDetail.lines[0]!.variant_id,
        payment_method_id: confirmedDetail.payment!.payment_method_id,
        fulfillment_method: confirmedDetail.delivery_snapshot.fulfillment_method,
        pickup_at: confirmedDetail.pickup_at,
        due_at: confirmedDetail.due_at,
        timezone_snapshot: confirmedDetail.timezone_snapshot,
        price_snapshot: confirmedDetail.price_snapshot,
        hold_expires_at: null,
        version,
        created_at: confirmedDetail.created_at,
      },
    },
    requestId: "req-mutation",
  };
}

describe("ReservationMutationActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
  });

  it("blocks a rapid Pick Up double-submit and sends one versioned intent", async () => {
    let resolvePickup: ((value: ReturnType<typeof mutationResult>) => void) | undefined;
    api.pickupReservation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePickup = resolve;
      })
    );
    const callbacks = renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Pick Up" }));
    const confirm = screen.getByRole("button", { name: "Confirm Pick Up" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(api.pickupReservation).toHaveBeenCalledTimes(1);
    expect(api.pickupReservation).toHaveBeenCalledWith(
      confirmedDetail.id,
      { version: 3 },
      expect.any(String)
    );

    resolvePickup?.(mutationResult("picked_up"));
    await waitFor(() => expect(callbacks.onMutationSuccess).toHaveBeenCalledTimes(1));
    expect(callbacks.onNotice).toHaveBeenLastCalledWith({
      tone: "success",
      message: "Pickup recorded.",
    });
  });

  it("reuses the same idempotency key for a network retry and rotates it when the request body changes", async () => {
    const ApiError = (await import("@/lib/drezivo-api")).DrezivoApiError;
    api.cancelReservation
      .mockRejectedValueOnce(new ApiError("Network unavailable.", { status: 503 }))
      .mockRejectedValueOnce(new ApiError("Network unavailable.", { status: 503 }))
      .mockResolvedValueOnce(mutationResult("cancelled"));
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Customer changed plans" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable.");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledTimes(2));
    const firstKey = api.cancelReservation.mock.calls[0]![2];
    const secondKey = api.cancelReservation.mock.calls[1]![2];
    expect(secondKey).toBe(firstKey);

    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Customer changed event date" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledTimes(3));
    expect(api.cancelReservation.mock.calls[2]![2]).not.toBe(firstKey);
    expect(api.cancelReservation.mock.calls[2]![1]).toEqual({
      version: 3,
      reason: "Customer changed event date",
    });
  });

  it("uses a new idempotency key after a definitive server rejection is resolved", async () => {
    const ApiError = (await import("@/lib/drezivo-api")).DrezivoApiError;
    api.pickupReservation
      .mockRejectedValueOnce(
        new ApiError("Payment verification is still required.", {
          code: "PAYMENT_PREREQUISITE_FAILED",
          status: 409,
          requestId: "req-payment-blocked",
        })
      )
      .mockResolvedValueOnce(mutationResult("picked_up"));
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Pick Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Pick Up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment verification is still required."
    );
    const firstKey = api.pickupReservation.mock.calls[0]![2];

    fireEvent.click(screen.getByRole("button", { name: "Confirm Pick Up" }));
    await waitFor(() => expect(api.pickupReservation).toHaveBeenCalledTimes(2));
    expect(api.pickupReservation.mock.calls[1]![2]).not.toBe(firstKey);
  });

  it("confirms an already verified pending reservation through the merchant confirmation endpoint", async () => {
    const pendingDetail = reservationDetail.parse({
      ...confirmedDetail,
      status: "pending_confirmation",
      confirmed_at: null,
      version: 2,
    });
    api.confirmReservation.mockResolvedValueOnce({
      data: mutationResult("confirmed", 3).data,
      requestId: "req-confirm",
    });
    const callbacks = renderActions(pendingDetail);

    fireEvent.click(screen.getByRole("button", { name: "Confirm Reservation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm Reservation" })[1]!);

    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledTimes(1));
    expect(api.confirmReservation).toHaveBeenCalledWith(pendingDetail.id, { version: 2 }, expect.any(String));
    expect(api.completeStaffReservation).not.toHaveBeenCalled();
    expect(callbacks.onNotice).toHaveBeenLastCalledWith({
      tone: "success",
      message: "Reservation confirmed.",
    });
  });

  it("refreshes instead of auto-retrying when the reservation version is stale", async () => {
    const ApiError = (await import("@/lib/drezivo-api")).DrezivoApiError;
    api.pickupReservation.mockRejectedValueOnce(
      new ApiError("Reservation version changed.", {
        code: "STALE_VERSION",
        status: 409,
        requestId: "req-stale",
      })
    );
    const callbacks = renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Pick Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Pick Up" }));

    await waitFor(() => expect(callbacks.onRefreshRequired).toHaveBeenCalledTimes(1));
    expect(callbacks.onNotice).toHaveBeenLastCalledWith({
      tone: "attention",
      message:
        "This reservation changed in another session. The latest server state has been refreshed.",
    });
    expect(screen.queryByRole("button", { name: "Confirm Pick Up" })).not.toBeInTheDocument();
  });

  it("sends the selected inspection readiness and condition note without authoring reservation state", async () => {
    const returnedDetail = reservationDetail.parse({
      ...confirmedDetail,
      status: "returned",
      version: 5,
      confirmed_at: confirmedDetail.confirmed_at,
      lines: confirmedDetail.lines.map((line) => ({
        ...line,
        current_asset_readiness: "unready" as const,
      })),
    });
    api.inspectReservationReturn.mockResolvedValueOnce({
      data: {
        ...mutationResult("returned", 5).data,
        asset_readiness: "needs_cleaning",
      },
      requestId: "req-inspection",
    });
    renderActions(returnedDetail);

    expect(screen.getByRole("button", { name: "Complete Rental" })).toBeDisabled();
    expect(
      screen.getByText(
        "Inspect the returned garment and mark it Ready before completing the rental."
      )
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Inspect Return" }));
    fireEvent.change(screen.getByLabelText("Garment readiness"), {
      target: { value: "needs_cleaning" },
    });
    fireEvent.change(screen.getByLabelText("Condition note (optional)"), {
      target: { value: "Light makeup stain near collar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Inspection" }));

    await waitFor(() => expect(api.inspectReservationReturn).toHaveBeenCalledTimes(1));
    expect(api.inspectReservationReturn).toHaveBeenCalledWith(
      returnedDetail.id,
      {
        version: 5,
        readiness: "needs_cleaning",
        condition_note: "Light makeup stain near collar",
      },
      expect.any(String)
    );
  });

  it("collects a new customer before completing a customer-less held reservation", async () => {
    const heldDetail = reservationDetail.parse({
      ...confirmedDetail,
      status: "held",
      customer: { customer_id: null, snapshot: null },
      terms_accepted_at: null,
      submitted_at: null,
      confirmed_at: null,
      hold_expires_at: "2026-10-10T02:15:00.000Z",
      version: 1,
    });
    api.completeStaffReservation.mockResolvedValueOnce(mutationResult("confirmed", 2));
    renderActions(heldDetail, ["reservations.manage"]);

    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));
    const confirm = screen.getAllByRole("button", { name: "Complete Reservation" })[1]!;
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Maria Walk-in" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Test Street" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Customer accepted the rental terms." }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(1));
    expect(api.completeStaffReservation).toHaveBeenCalledWith(
      heldDetail.id,
      {
        version: 1,
        terms_accepted: true,
        customer: {
          source: "new",
          customer: { full_name: "Maria Walk-in", phone: "09171234567", address: "123 Test Street" },
        },
      },
      expect.any(String)
    );
  });

  it("lets staff search and attach an existing customer to a held reservation", async () => {
    const heldDetail = reservationDetail.parse({
      ...confirmedDetail,
      status: "held",
      customer: { customer_id: null, snapshot: null },
      terms_accepted_at: null,
      submitted_at: null,
      confirmed_at: null,
      hold_expires_at: "2026-10-10T02:15:00.000Z",
      version: 1,
    });
    const customerId = "00000000-0000-4000-8000-000000000777";
    api.getStaffReservationIntakeOptions.mockResolvedValueOnce({
      data: {
        payment_methods: [],
        customers: [
          {
            id: customerId,
            full_name: "Maria Existing",
            phone: "09170000000",
            email: "maria@example.test",
            has_address: true,
          },
        ],
      },
      requestId: "req-intake",
    });
    api.completeStaffReservation.mockResolvedValueOnce(mutationResult("confirmed", 2));
    renderActions(heldDetail, ["reservations.manage"]);

    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));
    fireEvent.click(screen.getByRole("button", { name: "Existing customer" }));
    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "Maria" },
    });
    const customer = await screen.findByRole("button", { name: /Maria Existing/i });
    fireEvent.click(customer);
    expect(customer).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Customer accepted the rental terms." }));
    fireEvent.click(screen.getAllByRole("button", { name: "Complete Reservation" })[1]!);

    await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(1));
    expect(api.completeStaffReservation).toHaveBeenCalledWith(
      heldDetail.id,
      {
        version: 1,
        terms_accepted: true,
        customer: { source: "existing", customer_id: customerId },
      },
      expect.any(String)
    );
  });

  it("captures an address before completing a held pre-change customer snapshot", async () => {
    const heldDetail = reservationDetail.parse({
      ...confirmedDetail,
      status: "held",
      customer: {
        customer_id: "00000000-0000-4000-8000-000000000102",
        snapshot: {
          full_name: "Action Customer",
          phone: "09171234567",
          email: null,
          address: null,
        },
      },
      terms_accepted_at: null,
      submitted_at: null,
      confirmed_at: null,
      hold_expires_at: "2026-10-10T02:15:00.000Z",
      version: 1,
    });
    api.completeStaffReservation.mockResolvedValueOnce(mutationResult("confirmed", 2));
    renderActions(heldDetail, ["reservations.manage"]);

    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));
    const confirm = screen.getAllByRole("button", { name: "Complete Reservation" })[1]!;
    expect(screen.getByText("Address required")).toBeVisible();
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Legacy Street" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Customer accepted the rental terms." }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(1));
    expect(api.completeStaffReservation).toHaveBeenCalledWith(
      heldDetail.id,
      {
        version: 1,
        terms_accepted: true,
        customer: {
          source: "existing",
          customer_id: "00000000-0000-4000-8000-000000000102",
          address: "123 Legacy Street",
        },
      },
      expect.any(String)
    );
  });

  describe("payment by booking channel", () => {
    const pendingManual = (bookingChannel: "online" | "walk_in") =>
      reservationDetail.parse({
        ...confirmedDetail,
        status: "pending_confirmation",
        booking_channel: bookingChannel,
        confirmed_at: null,
        payment: {
          ...confirmedDetail.payment!,
          method_name: "Maya",
          rail: "manual_qr",
          status: "pending",
          evidence_status: bookingChannel === "online" ? "under_review" : "awaiting_upload",
          verified_at: null,
        },
      });

    beforeEach(() => {
      api.getReservationPaymentReceipts.mockResolvedValue({
        data: {
          receipts: [
            {
              file_id: "00000000-0000-4000-8000-000000000901",
              content_type: "image/png",
              url: "https://files.test/receipt.png",
              submitted_at: "2026-10-10T02:05:00.000Z",
              evidence_status: "under_review",
            },
          ],
        },
        requestId: "req-receipts",
      });
      api.verifyReservationPayment.mockResolvedValue({ data: {}, requestId: "req-verify" });
      api.completeStaffReservation.mockResolvedValue(mutationResult("confirmed"));
    });

    it("shows an online renter's proof and asks before verifying", async () => {
      renderActions(pendingManual("online"));

      fireEvent.click(screen.getByRole("button", { name: "Verify Payment" }));
      const thumbnail = await screen.findByRole("button", { name: "View proof of payment 1 full size" });
      expect(screen.queryByLabelText("Merchant reference")).not.toBeInTheDocument();

      // Verifying asks first; "View proof again" reopens the receipt instead of verifying.
      fireEvent.click(screen.getByRole("button", { name: "Verify & Confirm" }));
      expect(await screen.findByText("Is this payment verified?")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "View proof again" }));
      expect(await screen.findByAltText("Proof of payment 1")).toBeVisible();
      expect(api.verifyReservationPayment).not.toHaveBeenCalled();
      expect(thumbnail).toBeInTheDocument();
    });

    it("verifies an online payment only after the owner confirms", async () => {
      renderActions(pendingManual("online"));

      fireEvent.click(screen.getByRole("button", { name: "Verify Payment" }));
      await screen.findByRole("button", { name: "View proof of payment 1 full size" });
      fireEvent.click(screen.getByRole("button", { name: "Verify & Confirm" }));
      fireEvent.click(await screen.findByRole("button", { name: "Yes, it's verified" }));

      await waitFor(() => expect(api.verifyReservationPayment).toHaveBeenCalledTimes(1));
      expect(api.verifyReservationPayment.mock.calls[0]![1]).toEqual({
        version: 3,
        verified_amount_minor: "200000",
      });
      await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(1));
    });

    it("lets staff log a walk-in payment without a receipt or a confirmation prompt", async () => {
      renderActions(pendingManual("walk_in"));

      expect(screen.queryByRole("button", { name: "Verify Payment" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Log Payment" }));
      expect(api.getReservationPaymentReceipts).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Merchant reference"), { target: { value: "MAYA-123" } });
      fireEvent.click(screen.getByRole("button", { name: "Log Payment & Confirm" }));

      await waitFor(() => expect(api.verifyReservationPayment).toHaveBeenCalledTimes(1));
      expect(api.verifyReservationPayment.mock.calls[0]![1]).toEqual({
        version: 3,
        verified_amount_minor: "200000",
        merchant_reference: "MAYA-123",
      });
      expect(screen.queryByText("Is this payment verified?")).not.toBeInTheDocument();
    });
  });
});
