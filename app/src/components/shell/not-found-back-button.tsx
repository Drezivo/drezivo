"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function NotFoundBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="dashboard-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-md border border-dashboard-border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-canvas"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Go back
    </button>
  );
}
