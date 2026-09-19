import { Check } from "lucide-react";

export type OnboardingStep = "organization" | "plan" | "launch";

const STEPS: ReadonlyArray<{ id: OnboardingStep; label: string }> = [
  { id: "organization", label: "Organization" },
  { id: "plan", label: "Plan" },
  { id: "launch", label: "Launch" },
];

export function OnboardingProgress({ current }: { current: OnboardingStep }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol aria-label="Onboarding progress" className="flex items-start text-center">
      {STEPS.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isComplete = index < currentIndex;

        return (
          <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={[
                    "h-px flex-1",
                    index <= currentIndex ? "bg-auth-gold" : "bg-auth-line",
                  ].join(" ")}
                />
              ) : null}
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                  isComplete
                    ? "border-auth-gold bg-auth-gold text-auth-panel"
                    : isCurrent
                      ? "border-auth-gold text-auth-text ring-1 ring-auth-gold/40"
                      : "border-auth-line text-auth-dark-muted",
                ].join(" ")}
              >
                {isComplete ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.4} /> : index + 1}
              </span>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={[
                    "h-px flex-1",
                    index < currentIndex ? "bg-auth-gold" : "bg-auth-line",
                  ].join(" ")}
                />
              ) : null}
            </div>
            <span
              className={[
                "mt-3 text-xs font-medium sm:text-sm",
                isCurrent || isComplete ? "text-auth-text" : "text-auth-dark-muted",
              ].join(" ")}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
