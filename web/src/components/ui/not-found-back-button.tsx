'use client';

import { useRouter } from 'next/navigation';

export function NotFoundBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-atelier-paper-line px-7 text-sm font-medium text-atelier-ink transition-colors hover:border-atelier-gold-ink hover:text-atelier-gold-ink"
    >
      <span aria-hidden="true">←</span>
      Go back
    </button>
  );
}
