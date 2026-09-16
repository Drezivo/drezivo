"use client";

import { useAuth } from "@clerk/nextjs";
import type { StaffRole } from "./permissions";

/**
 * Maps the current Clerk organization role to Drezivo's two V1 staff roles (PRD §2: Owner,
 * Front desk). Clerk's org roles are tenant-configurable strings (`org:admin`,
 * `org:member`, ...); Drezivo provisions "org:owner" for the tenant creator and
 * "org:front_desk" for invited staff at signup time. Unrecognized roles fail closed to
 * "front_desk" — the more restrictive UX gate — never to "owner": granting elevated
 * client-side UX by default on an unrecognized value would be the wrong failure direction,
 * even though the server is the real authority (lib/permissions.ts).
 */
export function useStaffRole(): StaffRole | undefined {
  const { orgRole, isLoaded } = useAuth();
  if (!isLoaded) return undefined;
  if (orgRole === "org:owner") return "owner";
  return "front_desk";
}
