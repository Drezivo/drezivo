"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type AuthBackButtonProps = {
  href?: string;
  ariaLabel?: string;
};

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 28 28" fill="none">
      <path
        d="M22 14H6M13 7l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AuthBackButton({ href, ariaLabel = "Go back" }: AuthBackButtonProps) {
  const className =
    "relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-auth-text transition-colors hover:bg-auth-hover focus-visible:bg-auth-hover";

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={className}>
        <BackIcon />
      </Link>
    );
  }

  return <HistoryBackButton ariaLabel={ariaLabel} className={className} />;
}

function HistoryBackButton({ ariaLabel, className }: { ariaLabel: string; className: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => router.back()}
      className={className}
    >
      <BackIcon />
    </button>
  );
}
