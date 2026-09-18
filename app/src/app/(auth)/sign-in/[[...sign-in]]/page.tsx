import Image from "next/image";
import Link from "next/link";
import { AuthBackButton } from "@/components/auth/auth-back-button";
import { StaffSignInForm } from "@/components/auth/staff-sign-in-form";

export default function SignInPage() {
  return (
    <main className="auth-layout">
      <section aria-labelledby="sign-in-heading" className="auth-panel relative flex min-h-[100svh] flex-col px-6 py-8 sm:px-10 lg:px-16">
        <AuthBackButton />

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12 sm:py-16">
          <div className="mb-8 text-center">
            <div className="mb-6 flex items-center justify-center gap-3">
              <svg aria-hidden="true" className="h-10 w-10 text-auth-gold" viewBox="0 0 64 64" fill="none">
                <path
                  d="M32 6c-1.3 8.7-8.6 13.8-13.2 19.5C14.1 32.2 13.8 42.4 21 48.1c-2.8-7.3-.2-13.3 4.2-17.8 2.8-2.9 5.6-6.1 6.8-10.1 2.6 6.8 7.2 10.4 8.1 16.4.7 4.7-1.1 8.3-4.2 11.5 8.7-3.2 13.1-10.2 11.6-18.3-1-5.6-5.1-10-8.4-14.8C36.7 11.5 34.2 8.2 32 6Z"
                  fill="currentColor"
                />
                <path
                  d="M28.4 29.4c-4.1 5.1-6.2 10.1-2.2 16.3 3.4 5.3 8.9 5.1 12.5 1.9-3.6.2-6.9-1.8-7.9-5.2-.9-3.1.5-7.3-2.4-13Z"
                  fill="var(--color-auth-panel)"
                />
              </svg>
              <span className="font-display text-4xl leading-none text-auth-text">Drezivo</span>
            </div>

            <h1 id="sign-in-heading" className="font-display text-3xl leading-tight text-auth-text sm:text-4xl">
              Drezivo for professionals
            </h1>
            <p className="mt-3 text-sm text-auth-dark-muted sm:text-base">Sign in to manage your business.</p>
          </div>

          <StaffSignInForm />

          <p className="mt-8 text-center text-sm text-auth-dark-muted">
            Need an account?{" "}
            <Link href="/sign-up" className="font-medium text-auth-link underline-offset-4 hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </section>

      <aside aria-label="Drezivo fashion showcase" className="auth-image">
        <Image
          src="/auth-side.png"
          alt="Woman wearing a cream dress in a fashion showroom"
          fill
          priority
          sizes="55vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-auth-night via-auth-night/20 to-transparent" />
        <div className="absolute bottom-10 left-0 right-0 text-center text-auth-text">
          <p className="font-display text-4xl">Drezivo</p>
          <p className="text-sm tracking-[0.3em] text-auth-dark-muted">FOR PROFESSIONALS</p>
        </div>
      </aside>
    </main>
  );
}
