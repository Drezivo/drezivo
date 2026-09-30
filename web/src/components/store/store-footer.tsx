import Link from 'next/link';

import type { PublicStorefront } from '@drezivo/contracts';

import { storeNav } from './store-nav';

export function StoreFooter({ store }: { store: PublicStorefront }) {
  const { contact } = store;
  const socials = [
    contact.instagram_url ? { label: 'Instagram', href: contact.instagram_url } : null,
    contact.facebook_url ? { label: 'Facebook', href: contact.facebook_url } : null,
    contact.tiktok_url ? { label: 'TikTok', href: contact.tiktok_url } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);

  return (
    <footer id="contact" className="mt-24 border-t border-sf-line">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <p className="font-sf-display text-3xl font-light">{store.name}</p>
          {store.description ? <p className="mt-4 whitespace-pre-line text-sm leading-7 text-sf-muted">{store.description}</p> : null}
        </div>

        <div>
          <h2 className="text-sm font-medium">Visit</h2>
          <ul className="mt-4 space-y-2 text-sm text-sf-muted">
            {contact.address ? <li className="whitespace-pre-line">{contact.address}</li> : null}
            {contact.phone ? (
              <li>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="hover:text-sf-ink">
                  {contact.phone}
                </a>
              </li>
            ) : null}
            {contact.email ? (
              <li>
                <a href={`mailto:${contact.email}`} className="break-all hover:text-sf-ink">
                  {contact.email}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium">Shop</h2>
          <ul className="mt-4 space-y-2 text-sm text-sf-muted">
            {storeNav(store)
              .filter((item) => item.label !== 'Contact')
              .map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-sf-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
          </ul>
        </div>

        {socials.length > 0 ? (
          <div>
            <h2 className="text-sm font-medium">Follow</h2>
            <ul className="mt-4 space-y-2 text-sm text-sf-muted">
              {socials.map((social) => (
                <li key={social.href}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer" className="hover:text-sf-ink">
                    {social.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="border-t border-sf-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs text-sf-muted sm:px-8">
          <p>
            © {new Date().getFullYear()} {store.name}
          </p>
          <p>
            Bookings by{' '}
            <a href="https://drezivo.com" className="underline-offset-2 hover:underline">
              Drezivo
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
