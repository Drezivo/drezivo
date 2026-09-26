import Link from 'next/link';

interface StorefrontBrandProps {
  href: string;
  name: string;
  inverse?: boolean;
}

/** Shared tenant wordmark used by storefront chrome. */
export function StorefrontBrand({ href, name, inverse = false }: StorefrontBrandProps) {
  return (
    <Link
      href={href}
      aria-label={`${name} home`}
      className={`inline-flex min-w-0 items-center gap-3 ${inverse ? 'text-storefront-paper' : 'text-storefront-brand'}`}
    >
      <StorefrontDressMark className="h-11 w-8" />
      <span className="min-w-0">
        <span className="block truncate font-display text-xl font-semibold leading-none sm:text-2xl">
          {name}
        </span>
        <span
          className={`mt-1 block text-xs font-semibold uppercase tracking-widest ${
            inverse ? 'text-storefront-footer-muted' : 'text-storefront-muted'
          }`}
        >
          Clothing rentals
        </span>
      </span>
    </Link>
  );
}

export function StorefrontDressMark({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 5.5c0-2.2 1.8-4 4-4h2c2.2 0 4 1.8 4 4V8h-2.8V5.5c0-.7-.6-1.3-1.3-1.3h-1.8c-.7 0-1.3.6-1.3 1.3V8H19V5.5Z"
        fill="currentColor"
      />
      <path
        d="M17.1 9.2c1.9 3.7 4 5.5 6.9 5.5s5-1.8 6.9-5.5l4.2 3.2-2.7 12.5 10.2 31.8c-5.6 3.6-11.7 5.4-18.6 5.4S11 60.3 5.4 56.7l10.2-31.8-2.7-12.5 4.2-3.2Z"
        fill="currentColor"
      />
      <path
        d="M16.8 10.2c1.7 5.3 3.8 8.1 7.2 8.1s5.5-2.8 7.2-8.1"
        stroke="var(--color-storefront-paper)"
        strokeOpacity="0.58"
        strokeWidth="1.4"
      />
    </svg>
  );
}
