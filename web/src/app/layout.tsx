import type { Metadata } from 'next';
import { QueryProvider } from '@/components/ui/query-provider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drezivo.com'),
  title: { default: 'Drezivo', template: '%s | Drezivo' },
  description:
    'Drezivo — clothing rental management software for Philippine businesses, and the storefronts they publish.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the storefront's before-paint motion script adds a class here.
    // data-scroll-behavior: lets Next.js switch CSS smooth scrolling off during route changes.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
