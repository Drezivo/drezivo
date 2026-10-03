'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

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

export function VercelAnalytics() {
  return <Analytics beforeSend={sanitizeAnalyticsEvent} />;
}
