"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function NotFoundBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-dashboard-border px-7 text-sm font-medium text-dashboard-navy transition-colors hover:border-dashboard-accent hover:text-dashboard-accent"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Go back
    </button>
  );
}
