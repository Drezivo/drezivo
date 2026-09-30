"use client";

import { UserProfile, useAuth } from "@clerk/nextjs";
import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { ActorContext } from "@drezivo/contracts";

import { Section } from "@/components/forms/form-kit";
import { SECURITY_HASH, useLocationHash } from "@/components/settings/use-location-hash";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

const ROLE_LABEL: Record<string, string> = { owner: "Business owner", frontdesk: "Front desk" };

/**
 * Profile, password, two-step verification, email addresses, and active sessions are handled by
 * Clerk's own component, so credentials never pass through Drezivo code. The workspace role is
 * shown read-only because only an owner can change roles, from team management.
 */
export function AccountSettingsPage() {
  const { getToken } = useAuth();
  const hash = useLocationHash();
  const [actor, setActor] = useState<ActorContext | null>(null);

  useEffect(() => {
    let active = true;
    createDrezivoApiClient(getToken)
      .getActorContext()
      .then((result) => {
        if (active) setActor(result.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [getToken]);

  return (
    <div className="grid gap-4">
      {hash === SECURITY_HASH ? null : (
        <Section icon={BadgeCheck} title="Your role" description={actor ? `In ${actor.tenant.name}` : undefined}>
          <p className="text-sm font-medium text-dashboard-navy">{actor ? (ROLE_LABEL[actor.membership.role] ?? actor.membership.role) : "Loading…"}</p>
        </Section>
      )}
      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface">
        <UserProfile
          routing="hash"
          appearance={{
            // The dashboard is always dark; these mirror its tokens (.dashboard-theme-dark in globals.css).
            variables: {
              colorBackground: "#1a1a1a",
              colorText: "#f5f1eb",
              colorTextSecondary: "#aaa39b",
              colorPrimary: "#d2a15b",
              colorDanger: "#ff4d6d",
              colorNeutral: "#f5f1eb",
              colorInputBackground: "#141414",
              colorInputText: "#f5f1eb",
            },
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "none" },
              // The settings menu already switches between Profile and Security. Class names with
              // `!` win over Clerk's own styles, which inline style objects did not on phones.
              navbar: "!hidden",
              navbarMobileMenuRow: "!hidden",
            },
          }}
        />
      </div>
    </div>
  );
}
