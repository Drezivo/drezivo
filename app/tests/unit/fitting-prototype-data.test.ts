import { describe, expect, it } from "vitest";

import {
  FITTING_PROTOTYPE_APPOINTMENTS,
  FITTING_PROTOTYPE_RESOURCES,
  FITTING_PROTOTYPE_ROUTES,
} from "@/components/fittings/fitting-prototype-data";

describe("fitting prototype data", () => {
  it("keeps fitting navigation isolated to the prototype routes", () => {
    expect(FITTING_PROTOTYPE_ROUTES).toEqual({
      appointments: "/fittings",
      schedule: "/fittings/schedule",
    });
  });

  it("uses stable unique synthetic identifiers", () => {
    const appointmentIds = FITTING_PROTOTYPE_APPOINTMENTS.map((appointment) => appointment.id);
    const resourceIds = FITTING_PROTOTYPE_RESOURCES.map((resource) => resource.id);

    expect(new Set(appointmentIds).size).toBe(appointmentIds.length);
    expect(new Set(resourceIds).size).toBe(resourceIds.length);
    expect(appointmentIds.every((id) => id.startsWith("fit-proto-"))).toBe(true);
    expect(resourceIds.every((id) => id.startsWith("fit-resource-"))).toBe(true);
  });

  it("never presents a preference-only garment as a guaranteed physical asset", () => {
    const preferenceOnlyGarments = FITTING_PROTOTYPE_APPOINTMENTS.flatMap(
      (appointment) => appointment.garments
    ).filter((garment) => garment.guarantee === "Preference only");

    expect(preferenceOnlyGarments.length).toBeGreaterThan(0);
    expect(preferenceOnlyGarments.every((garment) => garment.assetCode === undefined)).toBe(true);
  });

  it("includes the Phase 0 attention scenarios needed for later visualization", () => {
    const attentionKinds = new Set(
      FITTING_PROTOTYPE_APPOINTMENTS.flatMap((appointment) => appointment.attention)
    );

    expect(attentionKinds).toEqual(
      new Set(["Payment review", "Resource missing", "Preference only"])
    );
  });

  it("uses synthetic customer contact details only", () => {
    for (const appointment of FITTING_PROTOTYPE_APPOINTMENTS) {
      expect(appointment.customer.email).toMatch(/@example\.test$/);
      expect(appointment.customer.phone).toMatch(/^0917 000 000\d$/);
    }
  });
});
