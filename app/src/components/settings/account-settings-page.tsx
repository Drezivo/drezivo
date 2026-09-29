"use client";

import { UserProfile, useAuth } from "@clerk/nextjs";
import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { ActorContext } from "@drezivo/contracts";

import { Section } from "@/components/forms/form-kit";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

const ROLE_LABEL: Record<string, string> = { owner: "Business owner", frontdesk: "Front desk" };

/**
 * Profile, password, two-step verification, email addresses, and active sessions are handled by
 * Clerk's own component, so credentials never pass through Drezivo code. The workspace role is
 * shown read-only because only an owner can change roles, from team management.
 */
export function AccountSettingsPage() {
  const { getToken } = useAuth();
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
      <Section icon={BadgeCheck} title="Your role" description={actor ? `In ${actor.tenant.name}` : undefined}>
        <p className="text-sm font-medium text-dashboard-navy">{actor ? (ROLE_LABEL[actor.membership.role] ?? actor.membership.role) : "Loading…"}</p>
      </Section>
      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface">
        <UserProfile
          routing="hash"
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "none" },
            },
          }}
        />
      </div>
    </div>
  );
}
