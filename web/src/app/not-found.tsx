import Link from 'next/link';

/**
 * The one 404 page for the whole app. It is deliberately generic — it is
 * also what renders for a foreign or unpublished tenant slug (see
 * src/app/s/[slug]/page.tsx), so it must never hint at whether a store
 * exists, only that this page doesn't.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-3xl text-foreground">Page not found</p>
      <p className="max-w-md text-sm text-muted">
        The page you&rsquo;re looking for doesn&rsquo;t exist or is no longer available.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Back to Drezivo
      </Link>
    </div>
  );
}
