/** The shortcut is a display preference; onboarding remains authorized by the API. */
export function isWorkspaceCreationAccount(user: {
  primaryEmailAddress?: {
    emailAddress: string;
    verification?: { status: string } | null;
  } | null;
} | null | undefined): boolean {
  const email = user?.primaryEmailAddress;
  return email?.verification?.status === "verified" &&
    email.emailAddress.toLowerCase() === "drezivoshop@gmail.com";
}
