import type { PublicStorefront } from '@drezivo/contracts';

/** Main navigation, shared by the header and footer. Sections the owner left empty are omitted. */
export function storeNav(store: PublicStorefront): Array<{ href: string; label: string }> {
  const base = `/s/${store.slug}`;
  return [
    { href: `${base}/catalog`, label: 'Collection' },
    { href: `${base}/policies`, label: 'Rental info' },
    ...(store.fitting.enabled ? [{ href: `${base}/fittings`, label: 'Fittings' }] : []),
    ...(store.content.sections.about && store.content.about.body ? [{ href: `${base}#about`, label: 'About' }] : []),
    { href: '#contact', label: 'Contact' },
  ];
}
