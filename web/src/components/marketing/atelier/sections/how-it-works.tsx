const STEPS = [
  {
    title: 'Set up in an afternoon',
    body: 'Add your pieces and sizes, your business hours, and how renters pay you. Staff join with their own sign-in.',
  },
  {
    title: 'Share your storefront link',
    body: 'Post drezivo.shop/s/your-shop on Facebook, Instagram, and TikTok. Renters browse, pick dates, and book without making an account.',
  },
  {
    title: 'Run the day from one screen',
    body: 'Confirm bookings, review payment proof, hand gowns over, and check them back in. Everyone on the team sees the same thing.',
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" data-header="dark" className="bg-atelier-night py-28 text-atelier-paper lg:py-40">
      <div className="at-container">
        <div className="max-w-[44rem]" data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-champagne">How it works</p>
          <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(2.5rem,5vw,4.5rem)] font-normal leading-[1.02] tracking-[-0.02em]">
            <span className="block overflow-hidden"><span data-at-line className="block">Three steps to{' '}</span></span>
            <span className="block overflow-hidden"><span data-at-line className="block italic">a quieter shop.{' '}</span></span>
          </h2>
        </div>
        <ol data-at-stagger className="mt-16 grid gap-px overflow-hidden rounded-[1.25rem] border border-atelier-night-line bg-atelier-night-line lg:mt-24 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} data-at-item className="bg-atelier-night-2 p-8 lg:p-10">
              <p className="font-[family-name:var(--font-atelier-display)] text-[4.5rem] leading-none text-atelier-champagne/90">{index + 1}</p>
              <h3 className="mt-10 font-[family-name:var(--font-atelier-display)] text-[1.75rem] font-normal leading-[1.15]">{step.title}</h3>
              <p className="mt-4 text-[1rem] leading-[1.75] text-atelier-mist">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
