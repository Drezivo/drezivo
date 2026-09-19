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
    <ol aria-label="Onboarding progress" className="mx-auto flex w-full max-w-md items-start text-center">
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
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  isComplete
                    ? "border-auth-gold bg-auth-gold text-auth-panel"
                    : isCurrent
                      ? "border-2 border-auth-gold text-auth-text ring-2 ring-auth-gold/20"
                      : "border-auth-line text-auth-dark-muted",
                ].join(" ")}
              >
                {isComplete ? <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.4} /> : index + 1}
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
                "mt-2 text-[11px] font-medium sm:text-xs",
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
