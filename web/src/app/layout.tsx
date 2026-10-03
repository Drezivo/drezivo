import type { Metadata } from 'next';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';
import { QueryProvider } from '@/components/ui/query-provider';
import './globals.css';
import { SITE_URL } from '@/lib/site-urls';

function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);

  // Booking URLs can contain visitor-specific reservation or capability data.
  if (/^\/s\/[^/]+\/booking(?:\/|$)/.test(url.pathname)) {
    return null;
  }

  // Search/filter values can contain personal data; item IDs are not needed for aggregate traffic.
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/^(\/s\/[^/]+\/items)\/[^/]+\/?$/, '$1/[itemId]');

  return { ...event, url: url.toString() };
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Drezivo', template: '%s | Drezivo' },
  description:
    'Drezivo — clothing rental management software for Philippine businesses, and the storefronts they publish.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the storefront's before-paint motion script adds a class here.
    // data-scroll-behavior: lets Next.js switch CSS smooth scrolling off during route changes.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
        <Analytics beforeSend={sanitizeAnalyticsEvent} />
      </body>
    </html>
  );
}
