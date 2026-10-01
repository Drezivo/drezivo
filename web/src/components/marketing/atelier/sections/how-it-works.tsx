import { PatternDraft } from '../art/pattern-draft';

const STEPS = [
  {
    title: 'Set up in an afternoon',
    body: 'Add your pieces and sizes, your business hours, and how renters pay you. Your storefront is ready the same day.',
  },
  {
    title: 'Share your storefront link',
    body: 'Post drezivo.shop/s/your-shop on Facebook, Instagram, and TikTok. Renters browse, pick dates, and book without making an account.',
  },
  {
    title: 'Run the day from one screen',
    body: 'Confirm bookings, review payment proof, hand gowns over, and check them back in. Every booking, payment, and garment in one place.',
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" data-header="dark" className="relative isolate overflow-hidden bg-atelier-night py-at-section text-atelier-paper">
      <PatternDraft id="how-it-works-draft" className="at-art inset-0 h-full w-full text-atelier-champagne opacity-[0.13]" />
      <div className="at-container">
        <div className="max-w-[44rem]" data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-champagne">How it works</p>
          <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display font-normal">
            <span className="block overflow-hidden"><span data-at-line className="block">Three steps to{' '}</span></span>
            <span className="block overflow-hidden"><span data-at-line className="block italic">a quieter shop.{' '}</span></span>
          </h2>
        </div>
        <ol data-at-stagger className="mt-at-stack grid gap-px overflow-hidden rounded-[1.25rem] border border-atelier-night-line bg-atelier-night-line md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} data-at-item className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 bg-atelier-night-2 p-6 sm:p-8 md:block lg:p-10">
              <p className="font-[family-name:var(--font-atelier-display)] text-at-numeral text-atelier-champagne/90">{index + 1}</p>
              <h3 className="font-[family-name:var(--font-atelier-display)] text-at-title font-normal md:mt-10">{step.title}</h3>
              <p className="col-span-2 mt-4 text-at-body text-atelier-mist">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
