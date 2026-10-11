import type { PublicStorefrontContact } from '@drezivo/contracts';

/**
 * Shown instead of online booking when the shop takes reservations by message. Lists only the
 * channels the shop filled in; with none, the line still tells the renter what to do.
 */
export function ContactToReserve({ contact }: { contact: PublicStorefrontContact }) {
  const links = [
    contact.facebook_url ? { href: contact.facebook_url, label: 'Facebook', external: true } : null,
    contact.instagram_url ? { href: contact.instagram_url, label: 'Instagram', external: true } : null,
    contact.tiktok_url ? { href: contact.tiktok_url, label: 'TikTok', external: true } : null,
    contact.phone ? { href: `tel:${contact.phone.replace(/\s+/g, '')}`, label: contact.phone, external: false } : null,
    contact.email ? { href: `mailto:${contact.email}`, label: contact.email, external: false } : null,
  ].filter((link): link is { href: string; label: string; external: boolean } => link !== null);

  return (
    <div className="mt-8 text-sm text-sf-muted">
      <p>This shop takes reservations by message. Contact the shop to reserve this piece.</p>
      {links.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Contact the shop">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="text-sf-ink underline underline-offset-4"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
