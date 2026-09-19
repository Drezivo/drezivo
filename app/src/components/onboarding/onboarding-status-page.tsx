import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { OnboardingStatusPanel } from "@/components/onboarding/onboarding-status-panel";

export function OnboardingStatusPage() {
  return (
    <AuthSplitLayout
      backHref="/sign-up"
      backAriaLabel="Back to sign up"
      panelAriaLabel="Onboarding status"
      lockViewport
    >
      <OnboardingStatusPanel />
    </AuthSplitLayout>
  );
}
