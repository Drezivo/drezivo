import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Drezivo",
    template: "%s · Drezivo",
  },
  description: "Drezivo staff authentication.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
