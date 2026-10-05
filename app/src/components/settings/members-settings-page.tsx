"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import type { MembershipInvitationList, MemberRosterResponse } from "@drezivo/contracts";
import { CalendarDays, Loader2, Mail, RefreshCw, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { ErrorState, Field, LoadingState, Section } from "@/components/forms/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

const PAGE_SIZE = 50;

type Invitation = MembershipInvitationList["items"][number];
type InvitationAction = "resend" | "cancel";

export function MembersSettingsPage() {
  const { getToken } = useAuth();
  const actor = useVerifiedActorContext();
  const [roster, setRoster] = useState<MemberRosterResponse | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const resendIntentRef = useRef<string | null>(null);
  const cancelIntentRef = useRef<string | null>(null);
  const createGuard = useSubmitGuard();
  const resendGuard = useSubmitGuard();
  const cancelGuard = useSubmitGuard();
  const isOwner = actor?.membership.role === "owner";
  const api = useMemo(() => createDrezivoApiClient(getToken), [getToken]);

  const reload = useCallback(() => setReloadToken((current) => current + 1), []);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);

    Promise.all([api.getMemberRoster(), api.getMembershipInvitations({ limit: PAGE_SIZE })])
      .then(([rosterResult, invitationResult]) => {
        if (!active) return;
        setRoster(rosterResult.data);
        setInvitations(invitationResult.data.items);
        setNextCursor(invitationResult.data.page_meta.next_cursor);
        setHasMore(invitationResult.data.page_meta.has_more);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(safeError(error, "Could not load your team. Please try again."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, isOwner, reloadToken]);

  async function loadMoreInvitations() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setMutationError(null);
    try {
      const result = await api.getMembershipInvitations({ limit: PAGE_SIZE, cursor: nextCursor });
      setInvitations((current) => [...current, ...result.data.items]);
      setNextCursor(result.data.page_meta.next_cursor);
      setHasMore(result.data.page_meta.has_more);
    } catch (error) {
      setMutationError(safeError(error, "Could not load more invitations."));
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleInviteOpenChange(open: boolean) {
    if (pendingActionRef.current) return;
    if (open) {
      setInviteError(null);
      setNotice(null);
    }
    setIsInviteOpen(open);
  }

  async function inviteFrontDesk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingActionRef.current || !email.trim()) return;
    const requestEmail = email.trim();
    pendingActionRef.current = "create";
    setPendingAction("create");
    setInviteError(null);
    setMutationError(null);
    try {
      const result = await createGuard.submit((idempotencyKey) =>
        api.createMembershipInvitation({ email: requestEmail }, idempotencyKey)
      );
      if (!result) return;
      setIsInviteOpen(false);
      setEmail("");
      setNotice(
        "Invitation request accepted. Delivery is handled in the background and may take a moment."
      );
      reload();
    } catch (error) {
      setInviteError(safeError(error, "Could not create the invitation. Please try again."));
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }

  async function changeInvitation(action: InvitationAction, invitationId: string) {
    if (pendingActionRef.current) return;
    const intent = `${action}:${invitationId}`;
    const guard = action === "resend" ? resendGuard : cancelGuard;
    const intentRef = action === "resend" ? resendIntentRef : cancelIntentRef;
    if (intentRef.current !== intent) {
      guard.resetIntent();
      intentRef.current = intent;
    }

    pendingActionRef.current = intent;
    setPendingAction(intent);
    setMutationError(null);
    setNotice(null);
    try {
      const result = await guard.submit((idempotencyKey) =>
        action === "resend"
          ? api.resendMembershipInvitation(invitationId, idempotencyKey)
          : api.cancelMembershipInvitation(invitationId, idempotencyKey)
      );
      if (!result) return;
      setNotice(
        action === "resend" ? "Invitation request queued for dispatch." : "Invitation cancelled."
      );
      reload();
    } catch (error) {
      setMutationError(safeError(error, `Could not ${action} this invitation. Please try again.`));
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }

  if (!actor) return <LoadingState label="Checking your workspace role…" />;
  if (!isOwner) {
    return (
      <section
        className="rounded-xl border border-dashboard-border bg-dashboard-surface p-5"
        role="alert"
      >
        <h2 className="text-base font-semibold text-dashboard-navy">Owner access required</h2>
        <p className="mt-1 text-sm text-dashboard-muted">
          Only the business owner can view and manage workspace members.
        </p>
      </section>
    );
  }
  if (isLoading) return <LoadingState label="Loading team members…" />;
  if (loadError || !roster)
    return <ErrorState message={loadError ?? "Could not load your team."} onRetry={reload} />;

  const atSeatLimit = roster.frontdesk_seats.used >= roster.frontdesk_seats.max;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-dashboard-muted">
          View who has access and invite Front Desk staff to this workspace.
        </p>
        <Button
          type="button"
          onClick={() => handleInviteOpenChange(true)}
          disabled={atSeatLimit || pendingAction !== null}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite Front Desk
        </Button>
      </div>

      {notice ? (
        <p
          className="rounded-lg border border-dashboard-green-text/20 bg-dashboard-green-text/5 px-4 py-3 text-sm text-dashboard-green-text"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {mutationError ? <ErrorState message={mutationError} /> : null}

      <Section icon={Users} title="Your team" description="Active members of this workspace.">
        <div className="mb-4 rounded-lg border border-dashboard-border bg-dashboard-canvas px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-dashboard-navy">Front Desk seats</p>
            <p
              className="text-sm tabular-nums text-dashboard-navy"
              aria-label={`${roster.frontdesk_seats.used} of ${roster.frontdesk_seats.max} Front Desk seats used`}
            >
              {roster.frontdesk_seats.used} / {roster.frontdesk_seats.max} used
            </p>
          </div>
          <p className="mt-1 text-xs text-dashboard-muted">
            Includes active Front Desk members and unexpired pending invitations. The Owner does not
            use a Front Desk seat.
          </p>
          {atSeatLimit ? (
            <p className="mt-2 text-xs font-medium text-dashboard-danger">
              The Front Desk seat limit has been reached.
            </p>
          ) : null}
        </div>

        {roster.members.length === 0 ? (
          <p className="py-4 text-sm text-dashboard-muted">No active members were found.</p>
        ) : (
          <ul className="divide-y divide-dashboard-border">
            {roster.members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent"
                    aria-hidden="true"
                  >
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-dashboard-navy">
                      {member.name ?? "Name unavailable"}
                    </p>
                    <p className="truncate text-xs text-dashboard-muted">
                      {member.email ?? "Email unavailable"}
                    </p>
                  </div>
                </div>
                <Badge variant={member.role === "owner" ? "secondary" : "outline"}>
                  {member.role === "owner" ? "Owner" : "Front Desk"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        icon={Mail}
        title="Invitations"
        description="Invitations stay active for seven days. Resending an expired or revoked invite starts a new seven-day window."
      >
        {invitations.length === 0 ? (
          <p className="py-4 text-sm text-dashboard-muted">No invitations yet.</p>
        ) : (
          <ul className="divide-y divide-dashboard-border">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                pendingAction={pendingAction}
                onResend={() => void changeInvitation("resend", invitation.id)}
                onCancel={() => void changeInvitation("cancel", invitation.id)}
              />
            ))}
          </ul>
        )}
        {hasMore ? (
          <Button
            className="mt-4"
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadMoreInvitations()}
            disabled={isLoadingMore}
            isPending={isLoadingMore}
            pendingLabel="Loading…"
          >
            Load more invitations
          </Button>
        ) : null}
      </Section>

      <Dialog.Root open={isInviteOpen} onOpenChange={handleInviteOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
                  <UserPlus className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                    Invite Front Desk staff
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                    Enter their email address. They will receive an invitation to join this business
                    as Front Desk staff.
                  </Dialog.Description>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close invitation dialog"
                disabled={pendingAction !== null}
                onClick={() => handleInviteOpenChange(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {inviteError ? (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger"
              >
                {inviteError}
              </div>
            ) : null}

            <form className="mt-5 grid gap-4" onSubmit={(event) => void inviteFrontDesk(event)}>
              <Field
                label="Email address"
                hint="The invitation is for the Front Desk role; roles cannot be changed here."
                error={null}
              >
                {({ id, "aria-describedby": describedBy }) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => {
                      createGuard.resetIntent();
                      setEmail(event.target.value);
                    }}
                    disabled={pendingAction === "create"}
                    aria-describedby={describedBy}
                  />
                )}
              </Field>
              <p className="text-xs text-dashboard-muted">
                {roster.frontdesk_seats.used} of {roster.frontdesk_seats.max} Front Desk seats
                reserved.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pendingAction === "create"}
                  onClick={() => handleInviteOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={atSeatLimit || pendingAction === "create"}
                  isPending={pendingAction === "create"}
                  pendingLabel="Queuing invitation…"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" /> Invite staff
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function InvitationRow({
  invitation,
  pendingAction,
  onResend,
  onCancel,
}: {
  invitation: Invitation;
  pendingAction: string | null;
  onResend: () => void;
  onCancel: () => void;
}) {
  const isPending =
    pendingAction === `resend:${invitation.id}` || pendingAction === `cancel:${invitation.id}`;
  const statusVariant =
    invitation.status === "accepted"
      ? "secondary"
      : invitation.status === "pending"
        ? "outline"
        : "destructive";

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-dashboard-navy">{invitation.email}</p>
          <Badge variant={statusVariant}>{statusLabel(invitation.status)}</Badge>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-dashboard-muted">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Expires{" "}
          {formatDate(invitation.expires_at)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {invitation.status !== "accepted" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pendingAction !== null}
            isPending={isPending && pendingAction?.startsWith("resend:")}
            onClick={onResend}
          >
            {isPending && pendingAction?.startsWith("resend:") ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            Resend
          </Button>
        ) : null}
        {invitation.status === "pending" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pendingAction !== null}
            isPending={isPending && pendingAction?.startsWith("cancel:")}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function statusLabel(status: Invitation["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof DrezivoApiError ? error.message : fallback;
}
