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
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
