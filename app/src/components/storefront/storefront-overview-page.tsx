"use client";

import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Copy,
  ExternalLink,
  Globe,
  LayoutTemplate,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Settings2,
  ShieldCheck,
  Store,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { StorefrontSettings } from "@drezivo/contracts";

import { ErrorState, LoadingState, PageHeader, Section } from "@/components/forms/form-kit";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { SocialLinks, StatusPill, StorefrontMiniPreview, storefrontUrl } from "./storefront-bits";
import { useStorefrontEditor } from "./storefront-editor";

export function StorefrontOverviewPage() {
  const editor = useStorefrontEditor();
  if (editor.loading && !editor.settings) return <Shell><LoadingState label="Loading your storefront…" /></Shell>;
  if (!editor.settings) return <Shell><ErrorState message={editor.loadError ?? "Could not load your storefront."} onRetry={editor.reload} /></Shell>;
  const settings = editor.settings;
  const liveUrl = settings.status === "published" ? storefrontUrl(settings.public_path) : null;

  return (
    <Shell>
      <PageHeader
        title="Storefront"
        description="Your public shop: what renters see, the rules they accept, and whether it is live."
        actions={
          <>
            <StatusPill status={settings.status} />
            {liveUrl ? (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary" })}>
                View storefront <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            ) : null}
            <Link href="/storefront/details" className={buttonVariants()}>
              <Pencil className="mr-2 h-4 w-4" /> Edit details
            </Link>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <OverviewCard settings={settings} />
        <Section icon={Globe} title="Preview" description="Your saved storefront, with your theme and hero.">
          <StorefrontMiniPreview settings={settings} />
          {settings.status !== "published" ? (
            <p className="mt-3 text-xs text-dashboard-muted">Renters cannot see this until you publish.</p>
          ) : null}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <DetailsSummary settings={settings} />
        <PublishCard settings={settings} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ManageCard href="/storefront/content" icon={LayoutTemplate} title="Homepage content" text="Hero, about, sections, and featured clothing." />
        <ManageCard href="/storefront/policies" icon={ShieldCheck} title="Rental policies" text={`Version ${settings.policy.version}${settings.policy.rules ? "" : " · not written yet"}`} />
        <ManageCard href="/storefront/requirements" icon={ClipboardList} title="Customer requirements" text="Details you ask renters for at checkout." />
        <ManageCard href="/storefront/settings" icon={Settings2} title="Booking settings" text="Handover time, notice, length, and fittings." />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </div>
  );
}

function OverviewCard({ settings }: { settings: StorefrontSettings }) {
  const { branding } = settings.document;
  const [copied, setCopied] = useState(false);
  const fullUrl = storefrontUrl(settings.public_path) ?? settings.public_path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="relative h-40 bg-dashboard-neutral-soft sm:h-48">
        {settings.media.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={settings.media.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-dashboard-muted">
            <Store className="mr-2 h-4 w-4" /> Add a cover photo in Edit details
          </div>
        )}
        <div className="absolute -bottom-9 left-5 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-dashboard-surface bg-dashboard-surface shadow-sm">
          {settings.media.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={settings.media.logo_url} alt={`${branding.display_name} logo`} className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-2xl text-dashboard-navy">{branding.display_name.slice(0, 1)}</span>
          )}
        </div>
      </div>
      <CardContent className="grid gap-5 p-5 pt-12 sm:grid-cols-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-dashboard-navy">{branding.display_name}</h2>
          <p className="mt-1 text-sm text-dashboard-muted">{branding.tagline ?? "Add a short tagline in Edit details."}</p>
          <div className="mt-4">
            <SocialLinks settings={settings} />
          </div>
        </div>
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-dashboard-muted">Store address</dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="min-w-0 truncate text-dashboard-navy">{fullUrl}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-dashboard-border px-2 text-xs text-dashboard-navy hover:bg-dashboard-active"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
              </button>
              {settings.status === "published" ? (
                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-dashboard-border px-2 text-xs text-dashboard-navy hover:bg-dashboard-active"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              ) : null}
            </dd>
            {settings.status === "published" ? null : (
              <p className="mt-1.5 text-xs leading-5 text-dashboard-muted">
                Not live yet. This link shows &ldquo;Page not found&rdquo; until you publish your storefront.
              </p>
            )}
          </div>
          <div>
            <dt className="text-xs font-medium text-dashboard-muted">Last saved</dt>
            <dd className="mt-1 text-dashboard-navy">{new Date(settings.updated_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function DetailsSummary({ settings }: { settings: StorefrontSettings }) {
  const { branding, contact } = settings.document;
  const rows = [
    { icon: Phone, value: contact.phone },
    { icon: Mail, value: contact.email },
    { icon: MapPin, value: contact.address },
  ];
  return (
    <Section
      icon={Store}
      title="Store details"
      description="What renters see about your business."
      action={
        <Link href="/storefront/details" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Link>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-dashboard-muted">About</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-dashboard-navy">{branding.description ?? "No description yet."}</p>
        </div>
        <ul className="grid gap-2.5 text-sm">
          {rows.map(({ icon: Icon, value }, index) => (
            <li key={index} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-muted" />
              <span className={value ? "whitespace-pre-line text-dashboard-navy" : "text-dashboard-muted"}>{value ?? "Not set"}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function PublishCard({ settings }: { settings: StorefrontSettings }) {
  const editor = useStorefrontEditor();
  const { readiness } = settings;
  const checks = [
    { ok: readiness.has_policy, label: "Rental policy written", href: "/storefront/policies" },
    { ok: readiness.has_active_clothing, label: "At least one active clothing item", href: "/inventory" },
    { ok: readiness.has_storefront_payment_method, label: "An online payment method is ready", href: "/settings/payment-methods" },
    { ok: readiness.has_contact, label: "A contact phone or email", href: "/storefront/details" },
  ];
  const published = settings.status === "published";
  const suspended = settings.status === "suspended";

  return (
    <Section icon={Globe} title="Status" description={published ? "Your storefront is live." : "Publish when every item below is done."}>
      <ul className="grid gap-2">
        {checks.map((check) => (
          <li key={check.label}>
            <Link href={check.href} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-dashboard-active">
              <span className="flex items-center gap-2.5">
                {check.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-dashboard-green-text" aria-label="Done" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-dashboard-muted" aria-label="Not done" />
                )}
                <span className={check.ok ? "text-dashboard-navy" : "text-dashboard-muted"}>{check.label}</span>
              </span>
              {!check.ok ? <ChevronRight className="h-4 w-4 text-dashboard-muted" /> : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-dashboard-border pt-4">
        {suspended ? (
          <p className="text-sm text-dashboard-danger">Drezivo support suspended this storefront. Contact support to restore it.</p>
        ) : (
          <Button
            className="w-full"
            variant={published ? "secondary" : "default"}
            disabled={editor.saving || (!published && !readiness.ready)}
            onClick={() => void editor.setPublished(!published)}
          >
            {editor.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {published ? "Unpublish storefront" : "Publish storefront"}
          </Button>
        )}
        {editor.saveState.kind === "error" ? (
          <p role="alert" className="mt-2 text-xs font-medium text-dashboard-danger">
            {editor.saveState.message}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function ManageCard({ href, icon: Icon, title, text }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <Link href={href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40">
      <Card className="h-full gap-0 py-0 transition-colors group-hover:border-dashboard-accent/40">
        <CardContent className="flex h-full flex-col p-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
            <Icon className="h-4.5 w-4.5" />
          </span>
          <span className="mt-3 text-sm font-semibold text-dashboard-navy">{title}</span>
          <span className="mt-1 flex-1 text-xs leading-5 text-dashboard-muted">{text}</span>
          <span className="mt-3 inline-flex items-center text-xs font-medium text-dashboard-accent">
            Manage <ChevronRight className="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
