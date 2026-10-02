import { ArrowUpRight, Mail, Ruler, Settings, Store, UsersRound } from "lucide-react";
import Link from "next/link";

import { PageHero } from "@/components/shell/page-hero";

const CONTACT_EMAIL = "drezivoshop@gmail.com";

/** Public FAQ on the marketing site; absent when the storefront origin is not configured. */
function faqUrl(): string | null {
  const origin = process.env["NEXT_PUBLIC_STOREFRONT_ORIGIN"]?.replace(/\/$/, "");
  return origin ? `${origin}/faq` : null;
}

interface Guide {
  question: string;
  steps: React.ReactNode[];
}

interface Topic {
  id: string;
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  guides: Guide[];
}

// Written against the screens as they are today; update a guide when its screen changes.
const TOPICS: Topic[] = [
  {
    id: "customers",
    title: "Customers",
    href: "/customers",
    icon: UsersRound,
    guides: [
      {
        question: "How do customers get into my list?",
        steps: [
          "A customer is created the first time they book a reservation or a fitting, from your storefront or from the workspace.",
          "There is no separate sign-up: each new booking adds or updates the customer automatically.",
        ],
      },
      {
        question: "How do I find, edit, or archive a customer?",
        steps: [
          "Search by name, phone, or email at the top of Customers. Use the status filter to switch between Active, Archived, and All.",
          "Open the ⋯ menu on a row (or select the row) for View details, Edit, and Archive.",
          "Archiving hides the customer from the active list. Their reservations and fittings stay on record.",
        ],
      },
    ],
  },
  {
    id: "fittings",
    title: "Fittings",
    href: "/fittings",
    icon: Ruler,
    guides: [
      {
        question: "How do I book a fitting?",
        steps: [
          "Select New Fitting, choose an existing customer or enter a new one, add the clothing to try on, then pick a date and start time.",
          "Times follow your business hours and the appointment length in Fitting settings.",
        ],
      },
      {
        question: "How do I change fitting length or how many run at once?",
        steps: [
          "Open Fitting settings on the Fittings page.",
          "Set the appointment duration (30-minute steps), the maximum fittings at the same time, and the fitting fee, then save.",
        ],
      },
      {
        question: "How do I reschedule or record the outcome of a fitting?",
        steps: [
          "Select the fitting in the list to open its details.",
          "From there you can reschedule it or record what happened after the appointment.",
        ],
      },
    ],
  },
  {
    id: "storefront",
    title: "Storefront",
    href: "/storefront",
    icon: Store,
    guides: [
      {
        question: "How do I publish my storefront?",
        steps: [
          "Open Storefront and finish every item in the Status checklist: a rental policy, at least one active clothing item, an online payment method, and a contact phone or email.",
          "Select Publish storefront. Until then, only you can see it through Preview.",
        ],
      },
      {
        question: "How do I change what renters see?",
        steps: [
          "Store details: your name, logo, theme colours, and contact links.",
          "Homepage content: the hero, about section, and featured clothing.",
          "Rental policies, Customer requirements, and Booking settings: the rules renters accept and the details they give at checkout.",
        ],
      },
      {
        question: "How do I share my storefront link?",
        steps: ["On the Storefront page, select Copy next to your link, or Preview to open it in a new tab."],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings and your account",
    href: "/settings",
    icon: Settings,
    guides: [
      {
        question: "Where do I change business details and hours?",
        steps: ["Settings › Business information holds your business name, contact details, address, and opening hours."],
      },
      {
        question: "How do renters pay me?",
        steps: [
          "Settings › Payment methods: add up to the allowed number of e-wallets or bank accounts.",
          "Type the details or upload the QR code or instructions you already use. A method shows on the storefront once its details are saved.",
        ],
      },
      {
        question: "How do I change my password or turn on two-step verification?",
        steps: [
          "Open the account menu (your initials, top right) and choose Password and security.",
          "Your name and email are under Your profile in the same menu.",
        ],
      },
      {
        question: "How do I switch between light and dark?",
        steps: ["Use the sun or moon button in the header, or choose Light, Dark, or Match system in the account menu."],
      },
    ],
  },
];

export function HelpCenterPage() {
  const faq = faqUrl();

  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter pb-12 pt-6">
      <div className="mx-auto w-full max-w-5xl">
        <PageHero
          headingId="help-heading"
          eyebrow="Help Center"
          title={
            <>
              How can we <em className="text-dashboard-accent">help?</em>
            </>
          }
          description="Short guides for everyday work in your workspace. If you are stuck, write to us and a person will reply."
        />

        <nav aria-label="Help topics" className="mt-ws-gap grid grid-cols-2 gap-ws-gap lg:grid-cols-4">
          {TOPICS.map(({ id, title, icon: Icon, guides }) => (
            <a
              key={id}
              href={`#${id}`}
              className="group rounded-xl border border-dashboard-border bg-dashboard-surface p-4 transition-colors hover:border-dashboard-accent/50 hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40"
            >
              <Icon className="h-5 w-5 text-dashboard-accent" />
              <span className="mt-3 block text-sm font-medium text-dashboard-navy">{title}</span>
              <span className="block text-xs text-dashboard-muted">
                {guides.length} {guides.length === 1 ? "guide" : "guides"}
              </span>
            </a>
          ))}
        </nav>

        <div className="mt-10 grid gap-10">
          {TOPICS.map(({ id, title, href, guides }) => (
            <section key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-dashboard-border pb-3">
                <h2 id={`${id}-heading`} className="font-display text-2xl font-medium text-dashboard-navy">
                  {title}
                </h2>
                <Link href={href} className="shrink-0 text-sm text-dashboard-accent underline-offset-4 hover:underline">
                  Open {title.split(" ")[0]}
                </Link>
              </div>
              <div className="divide-y divide-dashboard-border">
                {guides.map((guide) => (
                  <details key={guide.question} className="group py-1">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium text-dashboard-navy marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40 [&::-webkit-details-marker]:hidden">
                      {guide.question}
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashboard-border text-dashboard-muted transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <ol className="mb-3 grid list-decimal gap-1.5 pl-9 pr-8 text-sm leading-6 text-dashboard-muted marker:text-dashboard-accent">
                      {guide.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="support-heading"
          className="mt-12 grid gap-6 rounded-2xl border border-dashboard-border bg-dashboard-surface p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8"
        >
          <div>
            <p className="dashboard-eyebrow">Still need help?</p>
            <h2 id="support-heading" className="mt-1 font-display text-2xl font-medium text-dashboard-navy">
              Talk to the Drezivo team
            </h2>
            <p className="mt-1.5 max-w-xl text-sm text-dashboard-muted">
              Tell us your business name and what you were trying to do. Screenshots help.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="dashboard-button-default inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email {CONTACT_EMAIL}
            </a>
            {faq ? (
              <a
                href={faq}
                target="_blank"
                rel="noopener noreferrer"
                className="dashboard-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-md border border-dashboard-border px-4 text-sm font-medium transition-colors"
              >
                Read the public FAQ
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
