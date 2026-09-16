import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AppQueryProvider } from "@/lib/query-client";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Drezivo",
    template: "%s · Drezivo",
  },
  description: "Drezivo business dashboard — manage reservations, inventory, and payments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <AppQueryProvider>{children}</AppQueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
