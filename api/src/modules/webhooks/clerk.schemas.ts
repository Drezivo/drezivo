import { clerkWebhookEventType, type ClerkWebhookEventType } from '@drezivo/contracts';
import { z } from 'zod';

import { ValidationError } from '../../shared/errors.js';

const providerId = z.string().trim().min(1).max(255);
const providerEventType = z.enum([
  'organization.created',
  'organization.updated',
  'organization.deleted',
  'organizationInvitation.created',
  'organizationInvitation.accepted',
  'organizationInvitation.revoked',
  'organizationMembership.created',
  'organizationMembership.updated',
  'organizationMembership.deleted',
]);

type SupportedProviderEventType = z.infer<typeof providerEventType>;

const providerToCanonicalEventType: Record<SupportedProviderEventType, ClerkWebhookEventType> = {
  'organization.created': 'organization.created',
  'organization.updated': 'organization.updated',
  'organization.deleted': 'organization.deleted',
  'organizationInvitation.created': 'organization_invitation.created',
  'organizationInvitation.accepted': 'organization_invitation.accepted',
  'organizationInvitation.revoked': 'organization_invitation.revoked',
  'organizationMembership.created': 'organization_membership.created',
  'organizationMembership.updated': 'organization_membership.updated',
  'organizationMembership.deleted': 'organization_membership.deleted',
};

const providerEventEnvelope = z.object({
  type: z.string().trim().min(1).max(100),
  data: z.unknown(),
});

const organizationData = z.object({
  id: providerId,
  created_by: providerId.optional(),
  private_metadata: z.record(z.unknown()).optional(),
});

const invitationData = z.object({
  id: providerId,
  organization_id: providerId,
  user_id: providerId.optional(),
  role: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional(),
});

const membershipData = z.object({
  id: providerId,
  role: z.string().trim().min(1).max(100).optional(),
  organization: z.object({ id: providerId }),
  public_user_data: z.object({ user_id: providerId }).optional(),
});

export const onboardingMarker = z
  .object({
    source: z.literal('owner_onboarding_v1'),
    account_id: z.string().uuid(),
    attempt_id: z.string().uuid(),
  })
  .strict();

export type ClerkOnboardingMarker = z.infer<typeof onboardingMarker>;

export interface NormalizedClerkWebhookEvent {
  eventType: ClerkWebhookEventType;
  safePayload: Record<string, unknown>;
}

export type NormalizeClerkWebhookResult =
  | { kind: 'supported'; event: NormalizedClerkWebhookEvent }
  | { kind: 'ignored' };

function addIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

function parseSupportedData<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Webhook payload could not be accepted.');
  }
  return result.data;
}

function mapOrganizationData(data: unknown, eventType: ClerkWebhookEventType): NormalizedClerkWebhookEvent {
  const parsed = parseSupportedData(organizationData, data);
  const safePayload: Record<string, unknown> = { organization_id: parsed.id };
  addIfPresent(safePayload, 'created_by_user_id', parsed.created_by);

  if (eventType === 'organization.created') {
    const markerResult = onboardingMarker.safeParse(parsed.private_metadata?.drezivo_onboarding);
    if (markerResult.success) {
      safePayload.drezivo_onboarding = markerResult.data;
    }
  }

  return { eventType, safePayload };
}

function mapInvitationData(data: unknown, eventType: ClerkWebhookEventType): NormalizedClerkWebhookEvent {
  const parsed = parseSupportedData(invitationData, data);
  const safePayload: Record<string, unknown> = {
    organization_id: parsed.organization_id,
    invitation_id: parsed.id,
  };
  addIfPresent(safePayload, 'user_id', parsed.user_id);
  addIfPresent(safePayload, 'role', parsed.role);
  addIfPresent(safePayload, 'status', parsed.status);
  return { eventType, safePayload };
}

function mapMembershipData(data: unknown, eventType: ClerkWebhookEventType): NormalizedClerkWebhookEvent {
  const parsed = parseSupportedData(membershipData, data);
  const safePayload: Record<string, unknown> = {
    organization_id: parsed.organization.id,
    membership_id: parsed.id,
  };
  addIfPresent(safePayload, 'user_id', parsed.public_user_data?.user_id);
  addIfPresent(safePayload, 'role', parsed.role);
  return { eventType, safePayload };
}

/**
 * Converts a verified Clerk event into the closed contract event names and a deliberately small
 * replay-safe payload. Unknown provider event families are validly acknowledged by the route but
 * never enter the inbox.
 */
export function normalizeClerkWebhookEvent(event: unknown): NormalizeClerkWebhookResult {
  const envelope = providerEventEnvelope.safeParse(event);
  if (!envelope.success) {
    throw new ValidationError('Webhook payload could not be accepted.');
  }

  const providerType = providerEventType.safeParse(envelope.data.type);
  if (!providerType.success) {
    return { kind: 'ignored' };
  }

  const eventType = providerToCanonicalEventType[providerType.data];
  if (providerType.data.startsWith('organizationInvitation.')) {
    return { kind: 'supported', event: mapInvitationData(envelope.data.data, eventType) };
  }
  if (providerType.data.startsWith('organizationMembership.')) {
    return { kind: 'supported', event: mapMembershipData(envelope.data.data, eventType) };
  }
  return { kind: 'supported', event: mapOrganizationData(envelope.data.data, eventType) };
}

/** Ensures the canonical event type remains closed even if a map is edited incorrectly. */
export function isCanonicalClerkWebhookEventType(value: unknown): value is ClerkWebhookEventType {
  return clerkWebhookEventType.safeParse(value).success;
}
