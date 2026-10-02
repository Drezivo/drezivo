"use client";

import { AtSign, Link2, Palette, Store } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorState, Field, LoadingState, PageHeader, SaveBar, Section } from "@/components/forms/form-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { ImageField } from "./image-field";
import { StorefrontMiniPreview, ThemeSwatches, storefrontUrl } from "./storefront-bits";
import { useDocumentDraft, useStorefrontEditor } from "./storefront-editor";

const orNull = (value: string): string | null => (value.trim() === "" ? null : value);

export function StorefrontDetailsPage() {
  const editor = useStorefrontEditor();
  const branding = useDocumentDraft("branding");
  const contact = useDocumentDraft("contact");
  const [slug, setSlug] = useState("");
  const savedSlug = editor.settings?.slug ?? "";
  useEffect(() => setSlug(savedSlug), [savedSlug]);

  if (!editor.settings || !branding.draft || !contact.draft) {
    return <PageShell>{editor.loadError ? <ErrorState message={editor.loadError} onRetry={editor.reload} /> : <LoadingState label="Loading…" />}</PageShell>;
  }
  const settings = editor.settings;
  const b = branding.draft;
  const c = contact.draft;
  const err = (path: string) => editor.fieldErrors[path] ?? null;
  const dirty = branding.dirty || contact.dirty;

  return (
    <PageShell>
      <PageHeader title="Store details" description="Your name, look, and how renters reach you. Changes go live when you save if the storefront is published." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Section icon={Store} title="Identity">
            <div className="grid gap-4">
              <Field label="Store name" error={err("branding.display_name")} count={{ value: b.display_name.length, max: 80 }}>
                {(props) => <Input {...props} value={b.display_name} maxLength={80} onChange={(e) => branding.update({ display_name: e.target.value })} />}
              </Field>
              <Field label="Tagline" hint="One short line under your name, e.g. Gowns for debuts, weddings, and galas." error={err("branding.tagline")} count={{ value: b.tagline?.length ?? 0, max: 120 }}>
                {(props) => <Input {...props} value={b.tagline ?? ""} maxLength={120} onChange={(e) => branding.update({ tagline: orNull(e.target.value) })} />}
              </Field>
              <Field label="Short description" hint="Shown in your footer and search results." error={err("branding.description")} count={{ value: b.description?.length ?? 0, max: 600 }}>
                {(props) => <Textarea {...props} rows={4} value={b.description ?? ""} maxLength={600} onChange={(e) => branding.update({ description: orNull(e.target.value) })} />}
              </Field>
            </div>
          </Section>

          <Section icon={Palette} title="Look" description="Pick a palette. Every palette is tested for readable contrast.">
            <ThemeSwatches value={b.theme} onChange={(theme) => branding.update({ theme })} />
            <div className="mt-5 grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
              <ImageField label="Logo" hint="Square, at least 400 px." aspect="aspect-square" fileId={b.logo_file_id} savedUrl={settings.media.logo_url} onChange={(id) => branding.update({ logo_file_id: id })} />
              <ImageField label="Cover photo" hint="Wide, at least 1600 × 900 px." fileId={b.cover_file_id} savedUrl={settings.media.cover_url} onChange={(id) => branding.update({ cover_file_id: id })} />
            </div>
          </Section>

          <Section icon={AtSign} title="Contact" description="Shown on your storefront so renters can reach you. Phone, email, and address stay synced with Business Information.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" hint="Use exactly 11 digits." error={err("contact.phone")}>
                {(props) => (
                  <Input
                    {...props}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={11}
                    value={c.phone ?? ""}
                    placeholder="09xxxxxxxxx"
                    onChange={(e) =>
                      contact.update({
                        phone: orNull(e.target.value.replace(/\D/g, "").slice(0, 11)),
                      })
                    }
                  />
                )}
              </Field>
              <Field label="Email" error={err("contact.email")}>
                {(props) => <Input {...props} type="email" autoComplete="email" value={c.email ?? ""} placeholder="hello@yourshop.ph" onChange={(e) => contact.update({ email: orNull(e.target.value) })} />}
              </Field>
              <Field label="Shop address" className="sm:col-span-2" error={err("contact.address")}>
                {(props) => <Textarea {...props} rows={2} value={c.address ?? ""} maxLength={300} onChange={(e) => contact.update({ address: orNull(e.target.value) })} />}
              </Field>
              <Field label="Instagram" hint="Handle only, without the link." error={err("contact.instagram")}>
                {(props) => <Input {...props} value={c.instagram ?? ""} placeholder="@yourshop" onChange={(e) => contact.update({ instagram: orNull(e.target.value) })} />}
              </Field>
              <Field label="Facebook page" hint="The part after facebook.com/." error={err("contact.facebook")}>
                {(props) => <Input {...props} value={c.facebook ?? ""} placeholder="yourshop" onChange={(e) => contact.update({ facebook: orNull(e.target.value) })} />}
              </Field>
              <Field label="TikTok" error={err("contact.tiktok")}>
                {(props) => <Input {...props} value={c.tiktok ?? ""} placeholder="@yourshop" onChange={(e) => contact.update({ tiktok: orNull(e.target.value) })} />}
              </Field>
            </div>
          </Section>

          <Section icon={Link2} title="Store address" description="Changing it breaks links you already shared.">
            <Field label="Address" hint={`Your store will be at ${storefrontUrl(`/s/${slug || "your-shop"}`) ?? `/s/${slug || "your-shop"}`}`} error={err("slug")}>
              {(props) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    {...props}
                    value={slug}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
                      editor.markEdited();
                    }}
                  />
                  <Button type="button" variant="secondary" disabled={slug === settings.slug || editor.saving} onClick={() => void editor.saveSlug(slug)}>
                    Change address
                  </Button>
                </div>
              )}
            </Field>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-xs font-medium text-dashboard-muted">Preview (saved)</p>
          <StorefrontMiniPreview settings={settings} theme={b.theme} />
        </aside>
      </div>

      <SaveBar
        dirty={dirty}
        saving={editor.saving}
        state={editor.saveState}
        onSave={() => void editor.saveDocument({ ...settings.document, branding: b, contact: c })}
      />
    </PageShell>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter pt-6">
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </div>
  );
}
