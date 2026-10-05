"use client";

import { useAuth } from "@clerk/nextjs";
import { Check, ImageIcon, LayoutTemplate, Megaphone, Search, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MAX_FEATURED_PRODUCTS, type ClothingListItem, type ProductId, type StorefrontSections } from "@drezivo/contracts";

import { ErrorState, Field, LoadingState, PageHeader, SaveBar, Section, Switch } from "@/components/forms/form-kit";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import { ImageField } from "./image-field";
import { PageShell } from "./storefront-details-page";
import { useDocumentDraft, useStorefrontEditor } from "./storefront-editor";

const orNull = (value: string): string | null => (value.trim() === "" ? null : value);

const SECTION_COPY: Record<keyof StorefrontSections, { label: string; description: string }> = {
  categories: { label: "Shop by category", description: "A row of your active categories." },
  featured: { label: "Featured clothing", description: "The pieces you pick below, in your order." },
  new_arrivals: { label: "New arrivals", description: "Your eight most recently added pieces." },
  how_it_works: { label: "How renting works", description: "Three steps: reserve, pick up, return." },
  about: { label: "About your shop", description: "Your story with an optional photo." },
  rental_info: { label: "Rental information", description: "Deposit, cancellation, and delivery from your policy." },
  fitting: { label: "Book a fitting", description: "Only shows when fittings are open to online requests." },
};

export function StorefrontContentPage() {
  const editor = useStorefrontEditor();
  const content = useDocumentDraft("content");

  if (!editor.settings || !content.draft) {
    return <PageShell>{editor.loadError ? <ErrorState message={editor.loadError} onRetry={editor.reload} /> : <LoadingState label="Loading…" />}</PageShell>;
  }
  const settings = editor.settings;
  const draft = content.draft;
  const err = (path: string) => editor.fieldErrors[path] ?? null;

  return (
    <PageShell>
      <PageHeader title="Homepage content" description="What renters see first, and which sections your storefront shows." />

      <div className="grid gap-4">
        <Section icon={Megaphone} title="Announcement bar" description="Optional one-line notice at the very top, e.g. Now booking for December weddings.">
          <Field label="Announcement" error={err("content.announcement")} count={{ value: draft.announcement?.length ?? 0, max: 120 }}>
            {(props) => <Input {...props} value={draft.announcement ?? ""} maxLength={120} onChange={(e) => content.update({ announcement: orNull(e.target.value) })} />}
          </Field>
        </Section>

        <Section icon={Sparkles} title="Hero" description="The large first screen. Use your best photo.">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="grid content-start gap-4">
              <Field label="Heading" error={err("content.hero.heading")} count={{ value: draft.hero.heading.length, max: 80 }}>
                {(props) => <Input {...props} value={draft.hero.heading} maxLength={80} onChange={(e) => content.update({ hero: { ...draft.hero, heading: e.target.value } })} />}
              </Field>
              <Field label="Supporting text" error={err("content.hero.body")} count={{ value: draft.hero.body?.length ?? 0, max: 240 }}>
                {(props) => <Textarea {...props} rows={3} value={draft.hero.body ?? ""} maxLength={240} onChange={(e) => content.update({ hero: { ...draft.hero, body: orNull(e.target.value) } })} />}
              </Field>
            </div>
            <ImageField
              label="Hero photo"
              hint="Portrait or wide, at least 1600 px."
              aspect="aspect-[4/3]"
              fileId={draft.hero.image_file_id}
              savedUrl={settings.media.hero_image_url}
              fallbackUrl={settings.media.cover_url}
              fallbackLabel="Using cover photo"
              onChange={(id) => content.update({ hero: { ...draft.hero, image_file_id: id } })}
            />
          </div>
        </Section>

        <Section icon={ImageIcon} title="About your shop">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="grid content-start gap-4">
              <Field label="Heading" error={err("content.about.heading")} count={{ value: draft.about.heading?.length ?? 0, max: 80 }}>
                {(props) => <Input {...props} value={draft.about.heading ?? ""} maxLength={80} placeholder="Our story" onChange={(e) => content.update({ about: { ...draft.about, heading: orNull(e.target.value) } })} />}
              </Field>
              <Field label="Story" error={err("content.about.body")} count={{ value: draft.about.body?.length ?? 0, max: 1500 }}>
                {(props) => <Textarea {...props} rows={7} value={draft.about.body ?? ""} maxLength={1500} onChange={(e) => content.update({ about: { ...draft.about, body: orNull(e.target.value) } })} />}
              </Field>
            </div>
            <ImageField label="Photo" hint="Your shop, fitting room, or a favourite piece." aspect="aspect-[4/5]" fileId={draft.about.image_file_id} savedUrl={settings.media.about_image_url} onChange={(id) => content.update({ about: { ...draft.about, image_file_id: id } })} />
          </div>
        </Section>

        <Section icon={LayoutTemplate} title="Sections" description="Sections without content stay hidden even when switched on.">
          <div className="divide-y divide-dashboard-border">
            {(Object.keys(SECTION_COPY) as Array<keyof StorefrontSections>).map((key) => (
              <Switch
                key={key}
                label={SECTION_COPY[key].label}
                description={SECTION_COPY[key].description}
                checked={draft.sections[key]}
                onChange={(checked) => content.update({ sections: { ...draft.sections, [key]: checked } })}
              />
            ))}
          </div>
        </Section>

        <FeaturedPicker
          selected={draft.featured_product_ids}
          onChange={(ids) => content.update({ featured_product_ids: ids })}
          error={err("content.featured_product_ids")}
        />
      </div>

      <SaveBar dirty={content.dirty} saving={editor.saving} state={editor.saveState} onSave={() => void editor.saveDocument({ ...settings.document, content: draft })} />
    </PageShell>
  );
}

function FeaturedPicker({ selected, onChange, error }: { selected: ProductId[]; onChange: (ids: ProductId[]) => void; error: string | null }) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<ClothingListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    createDrezivoApiClient(getToken)
      .getCatalogueClothing({ limit: 100, product_status: "active", sort: "name_asc" })
      .then((result) => {
        if (!cancelled) setItems(result.data.items);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load your clothing.");
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (items ?? []).filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle));
  }, [items, query]);

  function toggle(id: ProductId) {
    if (selected.includes(id)) onChange(selected.filter((value) => value !== id));
    else if (selected.length < MAX_FEATURED_PRODUCTS) onChange([...selected, id]);
  }

  return (
    <Section icon={Star} title="Featured clothing" description={`Pick up to ${MAX_FEATURED_PRODUCTS}. They appear in the order you select them.`}>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted" />
        <Input className="pl-9" placeholder="Search clothing" aria-label="Search clothing" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {loadError ? <ErrorState message={loadError} /> : null}
      {items === null && !loadError ? <LoadingState label="Loading clothing…" /> : null}
      {items && items.length === 0 ? <p className="text-sm text-dashboard-muted">Add active clothing in Clothing to feature it here.</p> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {visible.map((item) => {
          const position = selected.indexOf(item.product_id);
          const chosen = position >= 0;
          const full = !chosen && selected.length >= MAX_FEATURED_PRODUCTS;
          return (
            <li key={item.product_id}>
              <button
                type="button"
                aria-pressed={chosen}
                disabled={full}
                onClick={() => toggle(item.product_id)}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
                  chosen ? "border-dashboard-accent ring-1 ring-dashboard-accent" : "border-dashboard-border hover:border-dashboard-muted",
                )}
              >
                <span className="block aspect-[3/4] bg-dashboard-neutral-soft">
                  {item.primary_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={item.primary_image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </span>
                <span className="block truncate px-2 py-1.5 text-xs font-medium text-dashboard-navy">{item.name}</span>
                {chosen ? (
                  <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-dashboard-primary px-1.5 text-xs font-semibold text-dashboard-primary-ink">
                    {position + 1}
                  </span>
                ) : (
                  <span className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-white/90 text-dashboard-navy group-hover:flex">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs font-medium text-dashboard-danger">{error}</p> : null}
    </Section>
  );
}
