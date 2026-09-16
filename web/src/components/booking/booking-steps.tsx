const STEPS = [
  { step: 1, label: 'Dates' },
  { step: 2, label: 'Details' },
  { step: 3, label: 'Review' },
] as const;

/** Shared step indicator for the three booking-flow pages. */
export function BookingSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Booking progress">
      {STEPS.map(({ step, label }, index) => (
        <li key={step} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              aria-current={step === current ? 'step' : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                step < current
                  ? 'bg-primary text-primary-foreground'
                  : step === current
                    ? 'border-2 border-primary text-primary'
                    : 'border border-border text-muted'
              }`}
            >
              {step < current ? '✓' : step}
            </span>
            <span
              className={`text-sm ${step === current ? 'font-medium text-foreground' : 'text-muted'}`}
            >
              {label}
            </span>
          </div>
          {index < STEPS.length - 1 ? <span className="h-px w-8 bg-border" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}
