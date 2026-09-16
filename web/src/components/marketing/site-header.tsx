import Link from 'next/link';

const NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];

/** Header for Drezivo's own marketing pages only — never rendered on a tenant storefront. */
export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-xl font-semibold text-foreground">
          Drezivo
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href="https://app.drezivo.com/sign-in"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
          >
            Sign In
          </a>
          <a
            href="https://app.drezivo.com/sign-up"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Get Started
          </a>
        </div>
      </div>
    </header>
  );
}
