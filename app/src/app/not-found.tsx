import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-100 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink-900">Page not found</h1>
      <p className="max-w-md text-sm text-ink-500">
        The page you&apos;re looking for doesn&apos;t exist, or you don&apos;t have access to it from this
        organization.
      </p>
      <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
