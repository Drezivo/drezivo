"use client";

import { useAuth, useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { membershipInvitationId } from "@drezivo/contracts";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AuthBrand } from "@/components/auth/auth-brand";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { listAllAccessibleWorkspaces } from "@/lib/workspace-access";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

type ClerkInvitationStatus = "sign_in" | "sign_up" | "complete";
type TicketContext = {
  ticket: string | null;
  status: ClerkInvitationStatus | null;
  organizationId: string | null;
};
type SecondFactorTarget =
  | { strategy: "email_code"; emailAddressId: string }
  | { strategy: "phone_code"; phoneNumberId: string }
  | { strategy: "totp" }
  | { strategy: "backup_code" };
type SignupVerification = "email" | "phone";
type InvitationState =
  | { kind: "reading" }
  | { kind: "working"; message: string }
  | { kind: "signup-details"; missingFields: string[] }
  | { kind: "signup-verification"; channel: SignupVerification }
  | { kind: "second-factor"; target: SecondFactorTarget }
  | { kind: "finalizing" }
  | { kind: "retry"; message: string }
  | { kind: "error"; message: string };

const CLAIM_RETRY_ATTEMPTS = 8;
const CLAIM_RETRY_DELAY_MS = 1_500;

export function AcceptInvitation({ invitationId: invitationIdInput }: { invitationId: string }) {
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [state, setState] = useState<InvitationState>({ kind: "reading" });
  const [ticketContext, setTicketContext] = useState<TicketContext | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [verificationCode, setVerificationCode] = useState("");
  const captured = useRef(false);
  const started = useRef(false);
  const claimInFlight = useRef(false);
  const keepInvitationRoute = useCallback(async () => undefined, []);
  const invitationId = membershipInvitationId.safeParse(invitationIdInput).success
    ? invitationIdInput
    : null;

  // Clerk places its one-time ticket and status in query parameters. Capture them only in memory,
  // and immediately replace the browser URL while retaining only the non-secret organization hint.
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const url = new URL(window.location.href);
    const rawStatus = url.searchParams.get("__clerk_status");
    const status: ClerkInvitationStatus | null =
      rawStatus === "sign_in" || rawStatus === "sign_up" || rawStatus === "complete"
        ? rawStatus
        : null;
    const organizationId = url.searchParams.get("organization_id");
    const ticket = url.searchParams.get("__clerk_ticket");
    window.history.replaceState(
      null,
      "",
      organizationId
        ? `${url.pathname}?organization_id=${encodeURIComponent(organizationId)}`
        : url.pathname
    );
    setTicketContext({ ticket, status, organizationId });
  }, []);

  const activateSession = useCallback(
    async (sessionId: string, organizationId: string) => {
      // The root ClerkProvider's normal sign-up fallback is Owner onboarding. Keep this ticket
      // flow on its callback until the exact local invitation has been claimed and verified.
      await setActive({
        session: sessionId,
        organization: organizationId,
        navigate: keepInvitationRoute,
      });
      setState({ kind: "finalizing" });
    },
    [keepInvitationRoute, setActive]
  );

  const finalizeWithoutTicket = useCallback(
    async (organizationId: string) => {
      await setActive({ organization: organizationId, navigate: keepInvitationRoute });
      setState({ kind: "finalizing" });
    },
    [keepInvitationRoute, setActive]
  );

  const finishSignIn = useCallback(
    async (attempt: NonNullable<typeof signIn>) => {
      if (
        attempt.status === "complete" &&
        attempt.createdSessionId &&
        ticketContext?.organizationId
      ) {
        await activateSession(attempt.createdSessionId, ticketContext.organizationId);
        return;
      }

      if (attempt.status === "needs_second_factor") {
        const target = await prepareInvitationSecondFactor(attempt);
        setState({ kind: "second-factor", target });
        return;
      }

      setState({
        kind: "error",
        message:
          "This account needs another sign-in step that cannot be completed from this invitation link. Please contact the workspace owner.",
      });
    },
    [activateSession, ticketContext]
  );

  const finishSignUp = useCallback(
    async (attempt: NonNullable<typeof signUp>) => {
      if (
        attempt.status === "complete" &&
        attempt.createdSessionId &&
        ticketContext?.organizationId
      ) {
        await activateSession(attempt.createdSessionId, ticketContext.organizationId);
        return;
      }

      if (attempt.unverifiedFields.includes("email_address")) {
        await attempt.prepareEmailAddressVerification({ strategy: "email_code" });
        setVerificationCode("");
        setState({ kind: "signup-verification", channel: "email" });
        return;
      }
      if (attempt.unverifiedFields.includes("phone_number")) {
        await attempt.preparePhoneNumberVerification({ strategy: "phone_code" });
        setVerificationCode("");
        setState({ kind: "signup-verification", channel: "phone" });
        return;
      }

      if (attempt.status === "missing_requirements") {
        setState({ kind: "signup-details", missingFields: attempt.missingFields });
        return;
      }

      setState({
        kind: "error",
        message:
          "Your account setup could not be completed. Ask the owner to resend the invitation.",
      });
    },
    [activateSession, ticketContext]
  );

  useEffect(() => {
    if (!invitationId) {
      setState({
        kind: "error",
        message: "This invitation link is invalid. Ask the owner to send a new one.",
      });
      return;
    }
    if (!ticketContext || !authLoaded || !signInLoaded || !signUpLoaded || started.current) return;

    if (!ticketContext.ticket) {
      if (!isSignedIn || !ticketContext.organizationId) {
        setState({
          kind: "error",
          message: "This invitation link is incomplete or expired. Ask the owner to resend it.",
        });
        return;
      }
      started.current = true;
      setState({ kind: "working", message: "Confirming your invitation and workspace access…" });
      void finalizeWithoutTicket(ticketContext.organizationId).catch((error: unknown) => {
        setState({ kind: "retry", message: toSafeMessage(error) });
      });
      return;
    }

    if (!ticketContext.organizationId || !ticketContext.status) {
      setState({
        kind: "error",
        message: "This invitation could not be verified. Ask the owner to send a new one.",
      });
      return;
    }

    started.current = true;
    void (async () => {
      try {
        if (ticketContext.status === "complete") {
          if (!isSignedIn) {
            setState({
              kind: "error",
              message:
                "Sign in with the account that received this invitation, then open the link again.",
            });
            return;
          }
          await finalizeWithoutTicket(ticketContext.organizationId!);
          return;
        }

        if (isSignedIn) {
          setState({
            kind: "error",
            message:
              "A different Drezivo session is already active. Sign out, then reopen the invitation email to continue with the invited account.",
          });
          return;
        }

        if (ticketContext.status === "sign_in") {
          setState({ kind: "working", message: "Signing you in securely…" });
          const attempt = await signIn!.create({
            strategy: "ticket",
            ticket: ticketContext.ticket!,
          });
          await finishSignIn(attempt);
          return;
        }

        setState({ kind: "working", message: "Creating your invited account…" });
        const attempt = await signUp!.create({ strategy: "ticket", ticket: ticketContext.ticket! });
        await finishSignUp(attempt);
      } catch {
        setState({
          kind: "error",
          message:
            "We could not verify this invitation. It may be expired or revoked; ask the workspace owner to resend it.",
        });
      }
    })();
  }, [
    authLoaded,
    finishSignIn,
    finishSignUp,
    finalizeWithoutTicket,
    invitationId,
    isSignedIn,
    signIn,
    signInLoaded,
    signUp,
    signUpLoaded,
    ticketContext,
  ]);

  async function submitSignupDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp || state.kind !== "signup-details") return;
    const missing = state.missingFields;
    const unsupported = missing.filter(
      (field) =>
        !["first_name", "last_name", "password", "username", "phone_number"].includes(field)
    );
    if (unsupported.length > 0) {
      setState({
        kind: "error",
        message:
          "Your account requires additional information. Ask the workspace owner to help complete your invitation.",
      });
      return;
    }

    setState({ kind: "working", message: "Saving your account details…" });
    try {
      const accountDetails: {
        firstName?: string;
        lastName?: string;
        password?: string;
        username?: string;
        phoneNumber?: string;
      } = {};
      const firstName = formValues["first_name"]?.trim();
      const lastName = formValues["last_name"]?.trim();
      const password = formValues["password"];
      const username = formValues["username"]?.trim();
      const phoneNumber = formValues["phone_number"]?.trim();
      if (missing.includes("first_name") && firstName) accountDetails.firstName = firstName;
      if (missing.includes("last_name") && lastName) accountDetails.lastName = lastName;
      if (missing.includes("password") && password) accountDetails.password = password;
      if (missing.includes("username") && username) accountDetails.username = username;
      if (missing.includes("phone_number") && phoneNumber) accountDetails.phoneNumber = phoneNumber;

      if (Object.values(accountDetails).some((value) => value.length === 0)) {
        setState({ kind: "signup-details", missingFields: missing });
        return;
      }
      if (
        missing.some(
          (field) =>
            !["first_name", "last_name", "password", "username", "phone_number"].includes(field)
        ) ||
        Object.keys(accountDetails).length !== missing.length
      ) {
        setState({ kind: "signup-details", missingFields: missing });
        return;
      }
      const attempt = await signUp.update(accountDetails);
      await finishSignUp(attempt);
    } catch {
      setState({
        kind: "error",
        message: "We could not save those account details. Please try the invitation link again.",
      });
    }
  }

  async function submitSignupVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp || state.kind !== "signup-verification") return;
    setState({ kind: "working", message: "Verifying your account…" });
    try {
      const attempt =
        state.channel === "email"
          ? await signUp.attemptEmailAddressVerification({ code: verificationCode.trim() })
          : await signUp.attemptPhoneNumberVerification({ code: verificationCode.trim() });
      await finishSignUp(attempt);
    } catch {
      setState({ kind: "signup-verification", channel: state.channel });
    }
  }

  async function submitSecondFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || state.kind !== "second-factor") return;
    const target = state.target;
    setState({ kind: "working", message: "Verifying your sign-in…" });
    try {
      const attempt = await signIn.attemptSecondFactor(
        target.strategy === "email_code"
          ? { strategy: "email_code", code: verificationCode.trim() }
          : target.strategy === "phone_code"
            ? { strategy: "phone_code", code: verificationCode.trim() }
            : target.strategy === "totp"
              ? { strategy: "totp", code: verificationCode.trim() }
              : { strategy: "backup_code", code: verificationCode.trim() }
      );
      await finishSignIn(attempt);
    } catch {
      setState({ kind: "second-factor", target });
    }
  }

  const retryClaim = useCallback(async () => {
    if (claimInFlight.current || !invitationId || !ticketContext?.organizationId) return;
    claimInFlight.current = true;
    setState({ kind: "finalizing" });
    const api = createDrezivoApiClient(getToken);

    try {
      await setActive({
        organization: ticketContext.organizationId,
        navigate: keepInvitationRoute,
      });
      let lastError: unknown;
      for (let attempt = 0; attempt < CLAIM_RETRY_ATTEMPTS; attempt += 1) {
        try {
          // A fresh intent key allows a retry after a persisted 409; membership creation itself is
          // duplicate-safe, and retries of one network attempt remain safe at the API boundary.
          const claim = await api.claimMembershipInvitation(invitationId, crypto.randomUUID());
          const workspaces = await listAllAccessibleWorkspaces(api);
          const targetWorkspace = workspaces.find(
            (workspace) => workspace.clerk_org_id === ticketContext.organizationId
          );
          if (
            !targetWorkspace ||
            targetWorkspace.role !== "frontdesk" ||
            claim.data.tenant.id !== targetWorkspace.tenant.id ||
            claim.data.membership.role !== "frontdesk"
          ) {
            throw new DrezivoApiError("Workspace access is still being finalized.", {
              status: 409,
            });
          }
          if (workspaces.length > 1) {
            window.location.replace("/workspaces/select");
            return;
          }
          window.location.replace(WORKSPACE_HOME);
          return;
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || attempt + 1 >= CLAIM_RETRY_ATTEMPTS) break;
          setState({ kind: "finalizing" });
          await delay(CLAIM_RETRY_DELAY_MS);
        }
      }
      const message = toSafeMessage(lastError);
      if (isTerminalInvitationFailure(lastError)) {
        setState({ kind: "error", message });
      } else {
        setState({ kind: "retry", message });
      }
    } catch (error) {
      const message = toSafeMessage(error);
      if (isTerminalInvitationFailure(error)) {
        setState({ kind: "error", message });
      } else {
        setState({ kind: "retry", message });
      }
    } finally {
      claimInFlight.current = false;
    }
  }, [getToken, invitationId, keepInvitationRoute, setActive, ticketContext]);

  // Start access reconciliation after Clerk ticket completion or when a signed-in user reopens the
  // already-consumed callback path. The ticket is never needed for the local idempotent claim.
  useEffect(() => {
    if (state.kind !== "finalizing" || !ticketContext?.organizationId) return;
    void retryClaim();
  }, [retryClaim, state.kind, ticketContext?.organizationId]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-auth-night px-5 py-10 text-auth-text">
      <section className="w-full max-w-lg" aria-live="polite">
        <AuthBrand />
        <div className="mt-10 rounded-2xl border border-auth-line bg-auth-panel p-7 shadow-xl sm:p-9">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-auth-gold/10 text-auth-gold">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-auth-gold">
                Drezivo workspace
              </p>
              <p className="mt-0.5 text-sm font-medium text-auth-text">Invitation acceptance</p>
            </div>
          </div>

          {state.kind === "reading" || state.kind === "working" || state.kind === "finalizing" ? (
            <div className="mt-8">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-auth-gold" aria-hidden="true" />
                <h1 className="font-display text-2xl sm:text-3xl">
                  {state.kind === "finalizing"
                    ? "Finishing workspace access"
                    : state.kind === "working"
                      ? "Accepting your invitation"
                      : "Checking invitation"}
                </h1>
              </div>
              <p className="mt-3 text-sm leading-6 text-auth-dark-muted">
                {state.kind === "working"
                  ? state.message
                  : "We are confirming your account and membership before opening business information."}
              </p>
              <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-auth-line">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-auth-gold" />
              </div>
            </div>
          ) : null}

          {state.kind === "signup-details" ? (
            <form className="mt-8 space-y-4" onSubmit={(event) => void submitSignupDetails(event)}>
              <h1 className="font-display text-2xl">Finish setting up your account</h1>
              <p className="text-sm leading-6 text-auth-dark-muted">
                Your invited email is verified by the invitation. Complete the required account
                details to continue.
              </p>
              {state.missingFields.map((field) => {
                const labels: Record<string, string> = {
                  first_name: "First name",
                  last_name: "Last name",
                  password: "Password",
                  username: "Username",
                  phone_number: "Phone number",
                };
                return (
                  <label key={field} className="block text-sm font-medium">
                    {labels[field] ?? "Required detail"}
                    <input
                      type={
                        field === "password"
                          ? "password"
                          : field === "phone_number"
                            ? "tel"
                            : "text"
                      }
                      autoComplete={
                        field === "password"
                          ? "new-password"
                          : field === "phone_number"
                            ? "tel"
                            : "given-name"
                      }
                      required
                      value={formValues[field] ?? ""}
                      onChange={(event) =>
                        setFormValues((previous) => ({ ...previous, [field]: event.target.value }))
                      }
                      className="mt-1 h-11 w-full rounded-lg border border-auth-line bg-transparent px-3 text-auth-text focus:border-auth-focus focus:outline-none focus:ring-2 focus:ring-auth-focus/40"
                    />
                  </label>
                );
              })}
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          ) : null}

          {state.kind === "signup-verification" ? (
            <form
              className="mt-8 space-y-4"
              onSubmit={(event) => void submitSignupVerification(event)}
            >
              <h1 className="font-display text-2xl">
                Verify your {state.channel === "email" ? "email" : "phone"}
              </h1>
              <p className="text-sm text-auth-dark-muted">
                Enter the verification code sent to your {state.channel}.
              </p>
              <input
                aria-label="Verification code"
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                className="h-12 w-full rounded-lg border border-auth-line bg-transparent px-4 text-center text-lg tracking-[0.35em] text-auth-text"
              />
              <Button type="submit" className="w-full">
                Verify and continue
              </Button>
            </form>
          ) : null}

          {state.kind === "second-factor" ? (
            <form className="mt-8 space-y-4" onSubmit={(event) => void submitSecondFactor(event)}>
              <h1 className="font-display text-2xl">Additional verification</h1>
              <p className="text-sm text-auth-dark-muted">
                {secondFactorLabel(state.target)} Enter your code to continue.
              </p>
              <input
                aria-label="Additional verification code"
                autoComplete="one-time-code"
                required
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                className="h-12 w-full rounded-lg border border-auth-line bg-transparent px-4 text-center text-lg tracking-[0.35em] text-auth-text"
              />
              <Button type="submit" className="w-full">
                Verify and continue
              </Button>
            </form>
          ) : null}

          {state.kind === "retry" || state.kind === "error" ? (
            <div className="mt-8" role="alert">
              <div className="flex items-center gap-2 text-auth-error">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <h1 className="font-display text-2xl">
                  {state.kind === "retry"
                    ? "Workspace access is still being finalized"
                    : "We could not accept this invitation"}
                </h1>
              </div>
              <p className="mt-3 text-sm leading-6 text-auth-dark-muted">{state.message}</p>
              {state.kind === "retry" ? (
                <Button className="mt-7" onClick={() => void retryClaim()}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Check access again
                </Button>
              ) : null}
              {state.kind === "error" ? (
                <Link
                  href="/sign-in"
                  className="mt-7 inline-flex min-h-10 items-center justify-center rounded-full bg-auth-button px-6 text-sm font-semibold text-auth-button-ink"
                >
                  Go to sign in
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

async function prepareInvitationSecondFactor(
  attempt: NonNullable<ReturnType<typeof useSignIn>["signIn"]>
): Promise<SecondFactorTarget> {
  const factor = attempt.supportedSecondFactors?.find((candidate) =>
    ["email_code", "phone_code", "totp", "backup_code"].includes(candidate.strategy)
  );
  if (!factor) throw new Error("unsupported_second_factor");
  if (factor.strategy === "email_code" && "emailAddressId" in factor) {
    await attempt.prepareSecondFactor({
      strategy: "email_code",
      emailAddressId: factor.emailAddressId,
    });
    return { strategy: "email_code", emailAddressId: factor.emailAddressId };
  }
  if (factor.strategy === "phone_code" && "phoneNumberId" in factor) {
    await attempt.prepareSecondFactor({
      strategy: "phone_code",
      phoneNumberId: factor.phoneNumberId,
    });
    return { strategy: "phone_code", phoneNumberId: factor.phoneNumberId };
  }
  if (factor.strategy === "totp") return { strategy: "totp" };
  if (factor.strategy === "backup_code") return { strategy: "backup_code" };
  throw new Error("unsupported_second_factor");
}

function secondFactorLabel(target: SecondFactorTarget): string {
  switch (target.strategy) {
    case "email_code":
      return "Enter the code sent to your email.";
    case "phone_code":
      return "Enter the code sent to your phone.";
    case "totp":
      return "Enter the code from your authenticator app.";
    case "backup_code":
      return "Enter one of your backup codes.";
  }
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof DrezivoApiError)) return true;
  return error.status === 409 || error.status === 429 || error.status >= 500;
}

function isTerminalInvitationFailure(error: unknown): boolean {
  return error instanceof DrezivoApiError && (error.status === 403 || error.status === 404);
}

function toSafeMessage(error: unknown): string {
  if (error instanceof DrezivoApiError) {
    if (error.status === 404 || error.status === 403) {
      return "The invitation is not valid for this account or workspace. Ask the owner to check or resend it.";
    }
    return "We have signed you in, but the workspace has not confirmed access yet. Try again in a moment.";
  }
  return "We could not confirm this invitation yet. Please try again, or ask the workspace owner for help.";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
