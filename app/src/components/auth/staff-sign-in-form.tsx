"use client";

import { useState, type FormEvent } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

type AuthFlow = "sign-in" | "sign-up";
type VerificationStep = "email" | "first-factor" | "second-factor";
type SecondFactorStrategy = "email_code" | "phone_code" | "totp" | "backup_code";

type SecondFactorTarget =
  | { strategy: "email_code"; emailAddressId: string }
  | { strategy: "phone_code"; phoneNumberId: string }
  | { strategy: "totp" }
  | { strategy: "backup_code" };

const GENERIC_ERROR = "We couldn't continue. Please check your details and try again.";

function getSecondFactorLabel(strategy: SecondFactorStrategy) {
  switch (strategy) {
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

type StaffSignInFormProps = {
  initialFlow?: AuthFlow;
};

export function StaffSignInForm({ initialFlow = "sign-in" }: StaffSignInFormProps) {
  const { isLoaded: isSignInLoaded, signIn, setActive: setActiveFromSignIn } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setActiveFromSignUp } = useSignUp();
  const [step, setStep] = useState<VerificationStep>("email");
  const [flow, setFlow] = useState<AuthFlow>(initialFlow);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [firstFactorEmailAddressId, setFirstFactorEmailAddressId] = useState<string | null>(null);
  const [secondFactorTarget, setSecondFactorTarget] = useState<SecondFactorTarget | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setActive = setActiveFromSignIn ?? setActiveFromSignUp;
  const isReady = isSignInLoaded && isSignUpLoaded && Boolean(signIn && signUp && setActive);

  async function prepareSecondFactor(attempt: NonNullable<typeof signIn>) {
    const factor = attempt.supportedSecondFactors?.find((candidate) =>
      ["email_code", "phone_code", "totp", "backup_code"].includes(candidate.strategy)
    );

    if (!factor) {
      setError("Additional verification is required. Please contact your administrator.");
      return false;
    }

    if (factor.strategy === "email_code" && "emailAddressId" in factor) {
      await attempt.prepareSecondFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      setSecondFactorTarget({ strategy: "email_code", emailAddressId: factor.emailAddressId });
    } else if (factor.strategy === "phone_code" && "phoneNumberId" in factor) {
      await attempt.prepareSecondFactor({ strategy: "phone_code", phoneNumberId: factor.phoneNumberId });
      setSecondFactorTarget({ strategy: "phone_code", phoneNumberId: factor.phoneNumberId });
    } else if (factor.strategy === "totp") {
      setSecondFactorTarget({ strategy: "totp" });
    } else if (factor.strategy === "backup_code") {
      setSecondFactorTarget({ strategy: "backup_code" });
    } else {
      setError("Additional verification is required. Please contact your administrator.");
      return false;
    }

    setCode("");
    setStep("second-factor");
    return true;
  }

  async function resolveAttempt(attempt: NonNullable<typeof signIn>) {
    if (attempt.status === "complete" && attempt.createdSessionId && setActive) {
      await setActive({ session: attempt.createdSessionId, redirectUrl: "/" });
      return;
    }

    if (attempt.status === "needs_second_factor") {
      await prepareSecondFactor(attempt);
      return;
    }

    setError("Additional verification is required. Please try again.");
  }

  async function startEmailSignUp(normalizedEmail: string) {
    if (!signUp) return;

    await signUp.create({ emailAddress: normalizedEmail });
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    setEmail(normalizedEmail);
    setFlow("sign-up");
    setCode("");
    setStep("first-factor");
  }

  async function resolveSignUpAttempt(attempt: NonNullable<typeof signUp>) {
    if (attempt.status === "complete" && attempt.createdSessionId && setActive) {
      await setActive({ session: attempt.createdSessionId, redirectUrl: "/" });
      return;
    }

    setError("Additional account verification is required. Please try again.");
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || !signIn || !signUp) return;

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address to continue.");
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      if (flow === "sign-up") {
        await startEmailSignUp(normalizedEmail);
        return;
      }

      const attempt = await signIn.create({ identifier: normalizedEmail });
      const factor = attempt.supportedFirstFactors?.find((candidate) => candidate.strategy === "email_code");

      if (!factor || !("emailAddressId" in factor)) {
        setError("Email verification is not available for this account.");
        return;
      }

      await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      setEmail(normalizedEmail);
      setFirstFactorEmailAddressId(factor.emailAddressId);
      setCode("");
      setFlow("sign-in");
      setStep("first-factor");
    } catch (caughtError) {
      if (
        flow === "sign-in" &&
        isClerkAPIResponseError(caughtError) &&
        caughtError.errors[0]?.code === "form_identifier_not_found"
      ) {
        try {
          await startEmailSignUp(normalizedEmail);
          return;
        } catch {
          setError(GENERIC_ERROR);
          return;
        }
      }

      setError(GENERIC_ERROR);
    } finally {
      setIsPending(false);
    }
  }

  async function handleFirstFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || !signIn) return;

    setError(null);
    setIsPending(true);

    try {
      if (flow === "sign-up") {
        const attempt = await signUp?.attemptEmailAddressVerification({ code: code.trim() });
        if (attempt) await resolveSignUpAttempt(attempt);
      } else {
        const attempt = await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
        await resolveAttempt(attempt);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsPending(false);
    }
  }

  async function handleSecondFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || !signIn || !secondFactorTarget) return;

    setError(null);
    setIsPending(true);

    try {
      const attempt =
        secondFactorTarget.strategy === "email_code"
          ? await signIn.attemptSecondFactor({ strategy: "email_code", code: code.trim() })
          : secondFactorTarget.strategy === "phone_code"
            ? await signIn.attemptSecondFactor({ strategy: "phone_code", code: code.trim() })
            : secondFactorTarget.strategy === "totp"
              ? await signIn.attemptSecondFactor({ strategy: "totp", code: code.trim() })
              : await signIn.attemptSecondFactor({ strategy: "backup_code", code: code.trim() });

      await resolveAttempt(attempt);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsPending(false);
    }
  }

  async function handleResend() {
    if (!isReady || !signIn || isPending) return;

    setError(null);
    setIsPending(true);

    try {
      if (step === "first-factor" && flow === "sign-up" && signUp) {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      } else if (step === "first-factor" && firstFactorEmailAddressId) {
        await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: firstFactorEmailAddressId });
      } else if (step === "second-factor" && secondFactorTarget?.strategy === "email_code") {
        await signIn.prepareSecondFactor({ strategy: "email_code", emailAddressId: secondFactorTarget.emailAddressId });
      } else if (step === "second-factor" && secondFactorTarget?.strategy === "phone_code") {
        await signIn.prepareSecondFactor({ strategy: "phone_code", phoneNumberId: secondFactorTarget.phoneNumberId });
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsPending(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!isReady || !signIn || isPending) return;

    setError(null);
    setIsPending(true);

    try {
      if (flow === "sign-up") {
        await signUp?.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/",
        });
      } else {
        await signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/",
        });
      }
    } catch {
      setError(GENERIC_ERROR);
      setIsPending(false);
    }
  }

  function handleStartOver() {
    setError(null);
    setCode("");
    setFirstFactorEmailAddressId(null);
    setSecondFactorTarget(null);
    setFlow(initialFlow);
    setStep("email");
  }

  const verificationLabel = secondFactorTarget ? getSecondFactorLabel(secondFactorTarget.strategy) : "";
  const showResend =
    step === "first-factor" || secondFactorTarget?.strategy === "email_code" || secondFactorTarget?.strategy === "phone_code";

  return (
    <div className="flex flex-col gap-5" data-testid="staff-sign-in-form">
      {error && (
        <p role="alert" className="rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error">
          {error}
        </p>
      )}

      {step === "email" && (
        <form className="flex flex-col gap-4" onSubmit={handleEmailSubmit}>
          <div className="flex flex-col gap-2">
            <label htmlFor="staff-email" className="text-sm font-medium text-auth-text">
              Email
            </label>
            <input
              id="staff-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-12 rounded-lg border border-auth-line bg-transparent px-4 text-auth-text placeholder:text-auth-dark-muted focus:border-auth-focus focus:outline-none focus:ring-2 focus:ring-auth-focus/40"
            />
            <p className="text-xs text-auth-dark-muted">We&apos;ll send you a verification code.</p>
          </div>
          <div id="clerk-captcha" data-cl-theme="dark" data-cl-size="flexible" />
          <button
            type="submit"
            disabled={!isReady || isPending}
            className="h-12 rounded-full bg-auth-button px-5 text-sm font-semibold text-auth-button-ink transition-colors hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Sending…" : flow === "sign-up" ? "Create account" : "Continue"}
          </button>
        </form>
      )}

      {step !== "email" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={step === "first-factor" ? handleFirstFactorSubmit : handleSecondFactorSubmit}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="staff-code" className="text-sm font-medium text-auth-text">
              Verification code
            </label>
            <input
              id="staff-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={12}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-12 rounded-lg border border-auth-line bg-transparent px-4 text-center text-lg tracking-[0.35em] text-auth-text placeholder:text-auth-dark-muted focus:border-auth-focus focus:outline-none focus:ring-2 focus:ring-auth-focus/40"
            />
            <p className="text-xs text-auth-dark-muted">
              {step === "first-factor"
                ? `${flow === "sign-up" ? "Verification code sent to" : "Code sent to"} ${email}.`
                : verificationLabel}
            </p>
          </div>
          <button
            type="submit"
            disabled={!isReady || isPending}
            className="h-12 rounded-full bg-auth-button px-5 text-sm font-semibold text-auth-button-ink transition-colors hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Verifying…" : flow === "sign-up" ? "Create account" : "Verify"}
          </button>
        </form>
      )}

      {step === "email" && (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-auth-dark-muted">
            <span className="h-px flex-1 bg-auth-line" />
            <span>or</span>
            <span className="h-px flex-1 bg-auth-line" />
          </div>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={!isReady || isPending}
            className="flex h-12 items-center justify-center gap-3 rounded-full border border-auth-line bg-transparent px-5 text-sm font-medium text-auth-text transition-colors hover:bg-auth-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleIcon />
            {isPending ? "Connecting…" : "Continue with Google"}
          </button>
        </>
      )}

      {step !== "email" && (
        <div className="flex items-center justify-between gap-4 text-xs text-auth-dark-muted">
          {showResend ? (
            <button type="button" onClick={handleResend} disabled={!isReady || isPending} className="hover:text-auth-text disabled:opacity-50">
              Resend code
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={handleStartOver} disabled={isPending} className="hover:text-auth-text disabled:opacity-50">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path d="M21.35 12.27c0-.78-.07-1.54-.22-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.42Z" fill="var(--color-google-blue)" />
      <path d="M12 21.75c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.75Z" fill="var(--color-google-green)" />
      <path d="M6.54 13.83A5.86 5.86 0 0 1 6.23 12c0-.64.11-1.26.31-1.83V7.64H3.3A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.06 1.05 4.36l3.24-2.53Z" fill="var(--color-google-yellow)" />
      <path d="M12 6.14c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.83 3.21 14.62 2.25 12 2.25a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53C7.31 7.86 9.46 6.14 12 6.14Z" fill="var(--color-google-red)" />
    </svg>
  );
}
