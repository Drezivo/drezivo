import { describe, expect, it } from "vitest";

import {
  FITTING_PROTOTYPE_APPOINTMENTS,
  FITTING_PROTOTYPE_ROUTES,
} from "@/components/fittings/fitting-prototype-data";

describe("fitting prototype data", () => {
  it("keeps fitting navigation isolated to the prototype routes", () => {
    expect(FITTING_PROTOTYPE_ROUTES).toEqual({
      appointments: "/fittings",
    });
  });

  it("uses stable unique synthetic appointment identifiers", () => {
    const appointmentIds = FITTING_PROTOTYPE_APPOINTMENTS.map((appointment) => appointment.id);

    expect(FITTING_PROTOTYPE_APPOINTMENTS).toHaveLength(20);
    expect(new Set(appointmentIds).size).toBe(appointmentIds.length);
    expect(appointmentIds.every((id) => id.startsWith("fit-proto-"))).toBe(true);
  });

  it("never presents a preference-only garment as a guaranteed physical asset", () => {
    const preferenceOnlyGarments = FITTING_PROTOTYPE_APPOINTMENTS.flatMap(
      (appointment) => appointment.garments
    ).filter((garment) => garment.guarantee === "Preference only");

    expect(preferenceOnlyGarments.length).toBeGreaterThan(0);
    expect(preferenceOnlyGarments.every((garment) => garment.assetCode === undefined)).toBe(true);
  });

  it("includes the fitting attention scenarios needed for later visualization", () => {
    const attentionKinds = new Set(
      FITTING_PROTOTYPE_APPOINTMENTS.flatMap((appointment) => appointment.attention)
    );

    expect(attentionKinds).toEqual(new Set(["Payment review", "Preference only"]));
  });

  it("keeps appointment status independent from fitting payment presentation", () => {
    const pendingPaymentStates = new Set(
      FITTING_PROTOTYPE_APPOINTMENTS.filter((appointment) => appointment.status === "Pending").map(
        (appointment) => appointment.paymentState
      )
    );
    const confirmedPaymentStates = new Set(
      FITTING_PROTOTYPE_APPOINTMENTS.filter(
        (appointment) => appointment.status === "Confirmed"
      ).map((appointment) => appointment.paymentState)
    );

    expect(pendingPaymentStates.has("Pending review")).toBe(true);
    expect(pendingPaymentStates.has("Verified")).toBe(true);
    expect(confirmedPaymentStates.has("Not required")).toBe(true);
    expect(confirmedPaymentStates.has("Verified")).toBe(true);
  });

  it("uses synthetic customer contact details only", () => {
    for (const appointment of FITTING_PROTOTYPE_APPOINTMENTS) {
      expect(appointment.customer.email).toMatch(/@example\.test$/);
      expect(appointment.customer.phone).toMatch(/^0917 000 \d{4}$/);
    }
  });
});
