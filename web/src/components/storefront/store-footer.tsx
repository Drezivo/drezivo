import Link from 'next/link';

import type { staticStorefrontClient } from '@/lib/static-storefront-client';
import { StorefrontBrand } from './storefront-brand';

type PublicStoreProjection = NonNullable<Awaited<ReturnType<typeof staticStorefrontClient.getStore>>>;

export function StoreFooter({ store }: { store: PublicStoreProjection }) {
  const basePath = `/s/${store.slug}`;
  const description =
    store.shortDescription ??
    `Browse ${store.displayName}'s rental collection and reserve clothing for your next event.`;

  return (
    <footer id="contact" className="bg-storefront-footer text-storefront-paper">
      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10 lg:px-20">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          <div className="pr-8 lg:border-r lg:border-storefront-paper/20">
            <StorefrontBrand href={basePath} name={store.displayName} inverse />
            <p className="mt-5 max-w-sm text-sm leading-6 text-storefront-footer-muted">
              {description}
            </p>
          </div>

          <FooterSection
            title="Get in Touch"
            className="lg:px-8 lg:border-r lg:border-storefront-paper/20"
          >
            <div className="space-y-4 text-sm text-storefront-footer-muted">
              {store.contactPhone ? (
                <ContactLine icon={<PhoneIcon />}>
                  <a href={`tel:${store.contactPhone}`} className="hover:text-storefront-paper">
                    {store.contactPhone}
                  </a>
                </ContactLine>
              ) : null}
              {store.address ? (
                <ContactLine icon={<PinIcon />}>
                  <span>{store.address}</span>
                </ContactLine>
              ) : null}
              {store.contactEmail ? (
                <ContactLine icon={<MailIcon />}>
                  <a href={`mailto:${store.contactEmail}`} className="hover:text-storefront-paper">
                    {store.contactEmail}
                  </a>
                </ContactLine>
              ) : null}
              {!store.contactPhone && !store.address && !store.contactEmail ? (
                <p>Contact information has not been published yet.</p>
              ) : null}
            </div>
          </FooterSection>

          <FooterSection
            title="Rental Info"
            className="lg:px-8 lg:border-r lg:border-storefront-paper/20"
          >
            <p className="text-sm leading-6 text-storefront-footer-muted">
              Review the shop&apos;s rental, deposit, pickup, delivery, and cancellation policies
              before booking.
            </p>
            <Link
              href={`${basePath}/policies`}
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-storefront-paper underline-offset-4 hover:underline"
            >
              View Rental Policies
            </Link>
          </FooterSection>

          <FooterSection title="Quick Links" className="lg:pl-8">
            <nav
              aria-label="Storefront footer navigation"
              className="grid gap-2 text-sm text-storefront-footer-muted"
            >
              <Link href={basePath} className="hover:text-storefront-paper">
                Home
              </Link>
              <Link href={`${basePath}/catalog`} className="hover:text-storefront-paper">
                Catalog
              </Link>
              <Link href={`${basePath}#categories`} className="hover:text-storefront-paper">
                Categories
              </Link>
              <Link href={`${basePath}#about`} className="hover:text-storefront-paper">
                About
              </Link>
              <Link href={`${basePath}/policies`} className="hover:text-storefront-paper">
                Rental Info
              </Link>
            </nav>
          </FooterSection>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-storefront-paper/20 pt-6 text-xs text-storefront-footer-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {store.displayName}. All rights reserved.
          </p>
          <p>Powered by Drezivo.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterSection({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <h2 className="font-display text-lg font-semibold text-storefront-paper">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ContactLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-storefront-paper">{icon}</span>
      <span className="leading-5">{children}</span>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 4h4l2 5-2.5 1.5a14 14 0 0 0 5 5L15 13l5 2v4c0 1.1-.9 2-2 2C9.7 21 3 14.3 3 6c0-1.1.9-2 2-2Z"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s6-5.4 6-12a6 6 0 1 0-12 0c0 6.6 6 12 6 12Z"
      />
      <circle cx="12" cy="9" r="2" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </svg>
  );
}
