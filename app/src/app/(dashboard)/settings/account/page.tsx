import { UserProfile } from "@clerk/nextjs";

// Account identity (name, email, password, MFA) is Clerk's own security surface — this
// page embeds Clerk's UserProfile rather than re-implementing credential management,
// which would duplicate a security-sensitive flow Clerk already handles correctly.
export default function AccountSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-500">Manage your name, sign-in email, and password.</p>
      <UserProfile
        routing="hash"
        appearance={{ elements: { rootBox: "w-full", card: "shadow-none border border-ink-300" } }}
      />
    </div>
  );
}
