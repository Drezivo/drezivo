import type { Metadata } from 'next';
import { VercelAnalytics } from '@/components/analytics';
import { QueryProvider } from '@/components/ui/query-provider';
import './globals.css';
import { SITE_URL } from '@/lib/site-urls';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Drezivo', template: '%s | Drezivo' },
  description:
    'Drezivo — clothing rental management software for Philippine businesses, and the storefronts they publish.',
  openGraph: {
    type: 'website',
    siteName: 'Drezivo',
    images: [{ url: '/marketing/drezivo_logo.png', width: 1254, height: 1254, type: 'image/png', alt: 'Drezivo logo' }],
  },
  twitter: { card: 'summary_large_image', images: ['/marketing/drezivo_logo.png'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the storefront's before-paint motion script adds a class here.
    // data-scroll-behavior: lets Next.js switch CSS smooth scrolling off during route changes.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
        <VercelAnalytics />
      </body>
    </html>
  );
}
