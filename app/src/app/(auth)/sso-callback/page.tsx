"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-auth-night px-6 text-auth-text">
      <p className="text-sm text-auth-dark-muted">Completing sign in…</p>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/auth/resolve"
        signUpFallbackRedirectUrl="/onboarding"
        signInForceRedirectUrl="/auth/resolve"
        signUpForceRedirectUrl="/onboarding"
      />
    </main>
  );
}
