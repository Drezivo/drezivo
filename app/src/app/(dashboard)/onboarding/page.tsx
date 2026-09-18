import Link from "next/link";

export default function OnboardingPlaceholderPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 rounded-lg border border-ink-300 bg-white p-6">
      <h1 className="text-xl font-semibold text-ink-900">Set up your workspace</h1>
      <p className="text-sm text-ink-600">
        No provisioned workspace is linked to this account yet. Continue the owner onboarding flow
        to create one.
      </p>
      <Link
        className="w-fit rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        href="/sign-up"
      >
        Continue setup
      </Link>
    </div>
  );
}
