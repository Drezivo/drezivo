import { AuthBrand } from "@/components/auth/auth-brand";

/**
 * The one "Opening your workspace" screen. The post-sign-in resolver and the dashboard access gate
 * both render exactly this, so the full reload between them reads as a single continuous screen
 * instead of two differently designed loaders.
 */
export function WorkspaceOpening() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-auth-night px-6 text-auth-text">
      <section className="w-full max-w-md text-center" role="status" aria-live="polite">
        <AuthBrand />
        <div className="mx-auto mt-10 h-10 w-10 animate-spin rounded-full border-2 border-auth-line border-t-auth-gold" />
        <h1 className="mt-7 font-display text-3xl">Opening your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-auth-dark-muted">
          We&apos;re checking your Drezivo access and setup.
        </p>
      </section>
    </main>
  );
}
