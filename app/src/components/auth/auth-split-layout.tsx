import Image from "next/image";
import type { ReactNode } from "react";

import { AuthBackButton } from "@/components/auth/auth-back-button";

type AuthSplitLayoutProps = {
  children: ReactNode;
  backHref?: string;
  backAriaLabel?: string;
  panelAriaLabel: string;
  lockViewport?: boolean;
};

export function AuthSplitLayout({
  children,
  backHref,
  backAriaLabel = "Go back",
  panelAriaLabel,
  lockViewport = false,
}: AuthSplitLayoutProps) {
  return (
    <main
      className={[
        "auth-layout",
        lockViewport ? "lg:h-[100svh] lg:max-h-[100svh] lg:overflow-y-hidden" : "",
      ].join(" ")}
    >
      <section
        aria-label={panelAriaLabel}
        className={[
          "auth-panel relative flex min-h-[100svh] flex-col px-6 py-8 sm:px-10 lg:px-16",
          lockViewport ? "lg:h-[100svh] lg:min-h-0 lg:max-h-[100svh] lg:overflow-y-auto" : "",
        ].join(" ")}
      >
        {backHref ? (
          <AuthBackButton href={backHref} ariaLabel={backAriaLabel} />
        ) : (
          <AuthBackButton />
        )}
        {children}
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
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-auth-night via-auth-night/20 to-transparent"
        />
        <div className="absolute bottom-10 left-0 right-0 text-center text-auth-text">
          <p className="font-display text-4xl">Drezivo</p>
          <p className="text-sm tracking-[0.3em] text-auth-dark-muted">FOR PROFESSIONALS</p>
        </div>
      </aside>
    </main>
  );
}
