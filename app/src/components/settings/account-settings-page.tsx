"use client";

import { UserProfile, useAuth } from "@clerk/nextjs";
import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { ActorContext } from "@drezivo/contracts";

import { Section } from "@/components/forms/form-kit";
import { SECURITY_HASH, useLocationHash } from "@/components/settings/use-location-hash";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { useTheme, type ResolvedTheme } from "@/lib/theme";

// Clerk renders in its own shadow of styles, so it gets the workspace tokens (globals.css) as values.
const CLERK_COLORS: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    colorBackground: "#fffcf7",
    colorText: "#1f1712",
    colorTextSecondary: "#6b5e53",
    colorPrimary: "#1f1712",
    colorDanger: "#b3311f",
    colorNeutral: "#1f1712",
    colorInputBackground: "#f5efe6",
    colorInputText: "#1f1712",
  },
  dark: {
    colorBackground: "#1b1511",
    colorText: "#f5efe6",
    colorTextSecondary: "#b9ada0",
    colorPrimary: "#d4b483",
    colorDanger: "#ff8a7a",
    colorNeutral: "#f5efe6",
    colorInputBackground: "#120e0b",
    colorInputText: "#f5efe6",
  },
};

const ROLE_LABEL: Record<string, string> = { owner: "Business owner", frontdesk: "Front desk" };

/**
 * Profile, password, two-step verification, email addresses, and active sessions are handled by
 * Clerk's own component, so credentials never pass through Drezivo code. The workspace role is
 * shown read-only because only an owner can change roles, from team management.
 */
export function AccountSettingsPage() {
  const { getToken } = useAuth();
  const hash = useLocationHash();
  const { resolved: theme } = useTheme();
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
            variables: { ...CLERK_COLORS[theme], fontFamily: "var(--font-sans)" },
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "none" },
              // The settings menu already switches between Profile and Security. Class names with
              // `!` win over Clerk's own styles, which inline style objects did not on phones.
              navbar: "!hidden",
              navbarMobileMenuRow: "!hidden",
              // The Settings heading above already names the page (Profile or Security); one h1 per page.
              headerTitle: "!hidden",
            },
          }}
        />
      </div>
    </div>
  );
}
