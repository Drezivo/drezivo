import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Bodoni_Moda, Jost } from "next/font/google";

import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { clerkFrontendApiOrigin } from "@/lib/clerk-origin";

import "./globals.css";

// The landing page's type pair (web/src/app/(marketing)/layout.tsx): Bodoni Moda for display,
// Jost for interface text. globals.css maps them to --font-display and --font-sans.
const display = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bodoni", display: "swap" });
const body = Jost({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jost", display: "swap" });

const CLERK_ORIGIN = clerkFrontendApiOrigin(process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);

export const metadata: Metadata = {
  title: {
    default: "Drezivo",
    template: "%s · Drezivo",
  },
  description: "Drezivo staff authentication.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme boot script sets data-dashboard-theme before React hydrates.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Clerk's script and session calls go to this origin; open the connection before they ask. */}
        {CLERK_ORIGIN ? <link rel="preconnect" href={CLERK_ORIGIN} crossOrigin="anonymous" /> : null}
      </head>
      <body suppressHydrationWarning>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/auth/resolve"
          signUpFallbackRedirectUrl="/onboarding"
          signInForceRedirectUrl="/auth/resolve"
          signUpForceRedirectUrl="/onboarding"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
