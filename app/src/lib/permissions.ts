/**
 * Client-side permission gating — UX ONLY. This decides whether to hide a control, disable
 * a button, or pick empty-state copy. It is never authorization: the API re-checks every
 * route server-side regardless of what this module returns (TRD §3, "Clerk's Express
 * authentication middleware recognizes credentials; the application must enforce API
 * authorization"). If this says a control should be enabled and the server disagrees, the
 * server wins and the user sees the generic ApiError from lib/api-client.ts — never a
 * silently-failed request.
 *
 * Modeled on the PRD §5 Owner / Front desk capability table.
 */

export type StaffRole = "owner" | "front_desk";

export interface PermissionContext {
  role: StaffRole;
}

export type Capability =
  // Owner-only (PRD §5: "Full" / "Full audited" in the Owner column, restricted for Front desk)
  | "reservations.refund"
  | "payments.verify_evidence"
  | "payments.reject_evidence"
  | "inventory.archive"
  | "settings.policies.edit"
  | "settings.users.manage"
  | "storefront.publish"
  | "exports.request"
  | "customers.export"
  | "customers.erase"
  // Available to both roles (PRD §5: "Create/update/custody", "Operational edits")
  | "reservations.create"
  | "reservations.update_custody"
  | "inventory.edit"
  | "customers.view"
  | "fittings.manage_notes";

const OWNER_ONLY: ReadonlySet<Capability> = new Set([
  "reservations.refund",
  "payments.verify_evidence",
  "payments.reject_evidence",
  "inventory.archive",
  "settings.policies.edit",
  "settings.users.manage",
  "storefront.publish",
  "exports.request",
  "customers.export",
  "customers.erase",
]);

export function can(context: PermissionContext, capability: Capability): boolean {
  if (context.role === "owner") return true;
  return !OWNER_ONLY.has(capability);
}
