import { AcceptInvitation } from "@/components/auth/accept-invitation";

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  return <AcceptInvitation invitationId={invitationId} />;
}
