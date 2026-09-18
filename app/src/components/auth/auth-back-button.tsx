"use client";

import { useRouter } from "next/navigation";

export function AuthBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => router.back()}
      className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-auth-text transition-colors hover:bg-auth-hover focus-visible:bg-auth-hover"
    >
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 28 28" fill="none">
        <path d="M22 14H6M13 7l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
