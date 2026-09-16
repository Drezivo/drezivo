import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-display text-lg">Drezivo</p>
            <p className="mt-2 max-w-xs text-sm text-primary-foreground/70">
              Clothing rental operations software for Philippine businesses.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-primary-foreground/70">
              <li>
                <Link href="/pricing">Pricing</Link>
              </li>
              <li>
                <Link href="/faq">FAQ</Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-primary-foreground/70">
              <li>
                <Link href="/terms">Terms of Service</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} Drezivo. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
