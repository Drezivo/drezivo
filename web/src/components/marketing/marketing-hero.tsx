import Image from 'next/image';

const SIGN_UP_URL = 'https://app.drezivo.com/sign-up';

const DASHBOARD_DAYS = [
  { id: 'mon', label: 'M', tone: 'bg-marketing-gold/65' },
  { id: 'tue', label: 'T', tone: 'bg-marketing-sage' },
  { id: 'wed', label: 'W', tone: 'bg-marketing-blush' },
  { id: 'thu', label: 'T', tone: 'bg-marketing-sage' },
  { id: 'fri', label: 'F', tone: 'bg-marketing-gold/65' },
  { id: 'sat', label: 'S', tone: 'bg-marketing-blush' },
  { id: 'sun', label: 'S', tone: 'bg-marketing-sage' },
] as const;

export function MarketingHero() {
  return (
    <section className="marketing-hero relative min-h-[100svh] overflow-hidden bg-marketing-cream">
      <div aria-hidden="true" data-testid="hero-background" className="absolute inset-y-0 right-0 hidden w-[58%] overflow-hidden lg:block">
        <Image
          src="/marketing/hero-reference.png"
          alt=""
          fill
          priority
          sizes="58vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-marketing-cream via-marketing-cream/55 to-transparent" />
        <div data-testid="hero-dashboard" className="absolute bottom-10 left-8 right-8 rounded-xl border border-marketing-line/70 bg-marketing-panel/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-marketing-line pb-2">
            <span className="text-[10px] font-semibold text-marketing-brown">Drezivo</span>
            <span className="text-[10px] text-marketing-muted">Rental Calendar</span>
            <span className="h-2 w-2 rounded-full bg-marketing-gold" />
          </div>
          <div className="mt-3 grid grid-cols-[4rem_1fr_4rem] gap-2">
            <div className="space-y-2 text-[8px] text-marketing-muted">
              <span className="block rounded bg-marketing-cream p-1">Overview</span>
              <span className="block p-1">Reservations</span>
              <span className="block p-1">Inventory</span>
              <span className="block p-1">Customers</span>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DASHBOARD_DAYS.map((day) => (
                <div key={day.id} className="text-center text-[8px] text-marketing-muted">
                  <span>{day.label}</span>
                  <span className={`mt-1 block h-14 rounded ${day.tone}`} />
                </div>
              ))}
            </div>
            <div className="space-y-2 text-[8px] text-marketing-muted">
              <span className="block rounded bg-marketing-cream p-1">Upcoming</span>
              <span className="block p-1">09:00 Pickup</span>
              <span className="block p-1">11:30 Return</span>
            </div>
          </div>
        </div>
      </div>

      <div className="marketing-container relative z-10 flex min-h-[100svh] items-center pb-12 pt-[calc(var(--marketing-header-height)+2rem)]">
        <div className="max-w-xl">
          <p className="marketing-eyebrow"><span aria-hidden="true" />Clothing rental management software<span aria-hidden="true" /></p>
          <h1 className="mt-6 font-display text-5xl leading-[1.04] tracking-tight text-marketing-ink sm:text-6xl">
            Run your clothing rental business effortlessly.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-marketing-muted">
            Drezivo helps you manage your inventory, reservations, customers, and operations—all in one place. Less manual work, more time for what matters.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={SIGN_UP_URL} className="marketing-button-primary px-6 py-3 text-sm">
              Get Started Free <span aria-hidden="true" className="ml-2 text-base">→</span>
            </a>
            <a href="#how-it-works" className="marketing-button-secondary px-6 py-3 text-sm">
              <span aria-hidden="true" className="mr-2 grid h-5 w-5 place-items-center rounded-full border border-marketing-brown text-[10px]">▶</span>
              See How It Works
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-marketing-muted">
            <span className="flex items-center gap-2"><span aria-hidden="true" className="text-marketing-gold">◌</span>Easy to use</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="text-marketing-gold">▣</span>No credit card required</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="text-marketing-gold">◷</span>Set up in minutes</span>
          </div>
        </div>
      </div>
    </section>
  );
}
