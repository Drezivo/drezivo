"use client";

import { Facebook, Instagram } from "lucide-react";

import { STOREFRONT_THEMES, type StorefrontSettings, type StorefrontTheme } from "@drezivo/contracts";

import { cn } from "@/lib/utils";

/** Public origin of the storefront app, e.g. https://drezivo.com. Falls back to showing the path only. */
export function storefrontUrl(path: string): string | null {
  const origin = process.env["NEXT_PUBLIC_STOREFRONT_ORIGIN"]?.replace(/\/$/, "");
  return origin ? `${origin}${path}` : null;
}

export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.8 5.8 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.3-1.6Z" />
    </svg>
  );
}

export function SocialLinks({ settings, className }: { settings: StorefrontSettings; className?: string }) {
  const { instagram, facebook, tiktok } = settings.document.contact;
  const links = [
    instagram ? { label: `Instagram @${instagram}`, href: `https://www.instagram.com/${instagram}/`, Icon: Instagram } : null,
    facebook ? { label: "Facebook page", href: `https://www.facebook.com/${facebook}`, Icon: Facebook } : null,
    tiktok ? { label: `TikTok @${tiktok}`, href: `https://www.tiktok.com/@${tiktok}`, Icon: TikTokIcon } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
  if (links.length === 0) return <span className="text-sm text-dashboard-muted">No social links yet</span>;
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {links.map(({ label, href, Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-dashboard-border text-dashboard-navy transition-colors hover:bg-dashboard-active"
        >
          <Icon className="h-4 w-4" />
        </a>
      ))}
    </span>
  );
}

export function StatusPill({ status }: { status: StorefrontSettings["status"] }) {
  const tone = {
    published: "bg-dashboard-green-soft text-dashboard-green-text",
    draft: "bg-dashboard-neutral-soft text-dashboard-neutral-text",
    suspended: "bg-dashboard-danger/10 text-dashboard-danger",
  }[status];
  const label = { published: "Published", draft: "Draft", suspended: "Suspended" }[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Small faithful render of the saved draft: theme colours, cover, name, and hero text. */
export function StorefrontMiniPreview({ settings, theme }: { settings: StorefrontSettings; theme?: StorefrontTheme }) {
  const palette = STOREFRONT_THEMES[theme ?? settings.document.branding.theme];
  const heroImage = settings.media.hero_image_url ?? settings.media.cover_url;
  const { branding, content } = settings.document;
  return (
    <div
      className="overflow-hidden rounded-lg border border-dashboard-border text-left"
      style={{ background: palette.background, color: palette.ink }}
      aria-label="Storefront preview"
    >
      <div className="flex items-center justify-between px-3 py-2 text-[10px]" style={{ borderBottom: `1px solid ${palette.line}` }}>
        <span className="font-display text-[13px]">{branding.display_name}</span>
        <span className="flex gap-3" style={{ color: palette.muted }}>
          <span>Collection</span>
          <span>Rental info</span>
          <span>Contact</span>
        </span>
      </div>
      <div className="relative aspect-[16/8]" style={{ background: palette.line }}>
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
          <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/55 via-black/10 to-transparent p-3 text-white">
          <p className="font-display text-lg leading-tight">{content.hero.heading}</p>
          {content.hero.body ? <p className="mt-1 line-clamp-2 text-[10px] opacity-90">{content.hero.body}</p> : null}
          <span className="mt-2 inline-flex w-fit rounded-sm px-2 py-1 text-[9px] font-medium" style={{ background: palette.accent, color: palette.accentInk }}>
            Browse the collection
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 p-3">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="aspect-[3/4] rounded-sm" style={{ background: palette.line }} />
        ))}
      </div>
    </div>
  );
}

export function ThemeSwatches({ value, onChange }: { value: StorefrontTheme; onChange: (theme: StorefrontTheme) => void }) {
  return (
    <div role="radiogroup" aria-label="Storefront theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(STOREFRONT_THEMES) as StorefrontTheme[]).map((key) => {
        const palette = STOREFRONT_THEMES[key];
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40",
              selected ? "border-dashboard-accent ring-1 ring-dashboard-accent" : "border-dashboard-border hover:border-dashboard-muted",
            )}
          >
            <span className="flex h-12 overflow-hidden rounded-md border border-black/5" aria-hidden="true">
              <span className="flex-[3]" style={{ background: palette.background }} />
              <span className="flex-1" style={{ background: palette.line }} />
              <span className="flex-1" style={{ background: palette.accent }} />
            </span>
            <span className="mt-2 block text-sm font-medium text-dashboard-navy">{palette.label}</span>
          </button>
        );
      })}
    </div>
  );
}
