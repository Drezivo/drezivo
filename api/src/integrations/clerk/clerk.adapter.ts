import { createClerkClient, type ClerkClient } from '@clerk/express';
import { z } from 'zod';

import { config } from '../../config/index.js';
import {
  DependencyUnavailableError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';

/**
 * The only Clerk organization roles Drezivo sends in v1. Clerk may expose additional custom
 * roles, but accepting arbitrary provider values here would let a caller bypass the local role
 * policy. New Drezivo roles must be added deliberately at this boundary.
 */
export const clerkOrganizationRoles = ['org:admin', 'org:member'] as const;
export type ClerkOrganizationRole = (typeof clerkOrganizationRoles)[number];

export const clerkInvitationStatuses = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type ClerkInvitationStatus = (typeof clerkInvitationStatuses)[number];

export const clerkInvitationDispatchOperations = ['create', 'resend'] as const;
export type ClerkInvitationDispatchOperation = (typeof clerkInvitationDispatchOperations)[number];

export const clerkInvitationDispatchSource = 'membership_invitation_dispatch_v1' as const;

export interface ClerkInvitationDispatchMarker {
  source: typeof clerkInvitationDispatchSource;
  invitationId: string;
  dispatchVersion: number;
  operation: ClerkInvitationDispatchOperation;
}

export interface ClerkOrganization {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string | null;
}

export interface ClerkOrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: ClerkOrganizationRole;
}

export interface ClerkOrganizationInvitation {
  id: string;
  organizationId: string;
  emailAddress: string;
  role: ClerkOrganizationRole;
  status: ClerkInvitationStatus | null;
  expiresAt: Date;
}

export interface ClerkUserVerificationState {
  primaryEmailVerified: boolean;
}

export interface ClerkServerAdapter {
  getUserVerificationState(userId: string): Promise<ClerkUserVerificationState>;
  createOrganization(input: CreateClerkOrganizationInput): Promise<ClerkOrganization>;
  getOrganization(organizationId: string): Promise<ClerkOrganization>;
  deleteOrganizationIfPresent(organizationId: string): Promise<boolean>;
  getOrganizationMembership(
    organizationId: string,
    userId: string,
  ): Promise<ClerkOrganizationMembership | null>;
  createInvitation(input: CreateClerkInvitationInput): Promise<ClerkOrganizationInvitation>;
  findInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<ClerkOrganizationInvitation | null>;
  findInvitationByDispatchMarker(
    organizationId: string,
    marker: ClerkInvitationDispatchMarker,
  ): Promise<ClerkOrganizationInvitation | null>;
  findInvitationsByInvitationId(
    organizationId: string,
    invitationId: string,
  ): Promise<ClerkOrganizationInvitation[]>;
  getInvitation(organizationId: string, invitationId: string): Promise<ClerkOrganizationInvitation>;
  revokeInvitation(input: RevokeClerkInvitationInput): Promise<ClerkOrganizationInvitation>;
  revokeInvitationIfPresent(
    input: RevokeClerkInvitationInput,
  ): Promise<ClerkOrganizationInvitation | null>;
  createMembership(input: ClerkMembershipInput): Promise<ClerkOrganizationMembership>;
  updateMembership(input: ClerkMembershipInput): Promise<ClerkOrganizationMembership>;
  deleteMembership(
    input: Pick<ClerkMembershipInput, 'organizationId' | 'userId'>,
  ): Promise<ClerkOrganizationMembership>;
}

/**
 * Narrow provider surface used by the adapter. Callers and tests inject this boundary instead of
 * importing or mocking Clerk throughout the application.
 */
export type ClerkProviderClient = {
  users: Pick<ClerkClient['users'], 'getUser'>;
  organizations: Pick<
    ClerkClient['organizations'],
    | 'createOrganization'
    | 'getOrganization'
    | 'deleteOrganization'
    | 'getOrganizationMembershipList'
    | 'createOrganizationMembership'
    | 'updateOrganizationMembership'
    | 'deleteOrganizationMembership'
    | 'createOrganizationInvitation'
    | 'getOrganizationInvitationList'
    | 'getOrganizationInvitation'
    | 'revokeOrganizationInvitation'
  >;
};

const providerId = z.string().trim().min(1).max(200);
const organizationName = z.string().trim().min(1).max(160);
const emailAddress = z.string().trim().email().max(320);
const organizationRole = z.enum(clerkOrganizationRoles);
const onboardingMarker = z.object({
  accountId: z.string().uuid(),
  attemptId: z.string().uuid(),
});
const organizationInput = z.object({
  name: organizationName,
  createdByUserId: providerId,
  onboardingMarker: onboardingMarker.optional(),
});
const invitationInput = z.object({
  organizationId: providerId,
  emailAddress,
  role: organizationRole,
  expiresInDays: z.number().int().min(1).max(30).optional(),
  inviterUserId: providerId.optional(),
  redirectUrl: z.string().url().max(2048).optional(),
  dispatchMarker: z
    .object({
      source: z.literal(clerkInvitationDispatchSource),
      invitationId: z.string().uuid(),
      dispatchVersion: z.number().int().positive(),
      operation: z.enum(clerkInvitationDispatchOperations),
    })
    .optional(),
});
const membershipInput = z.object({
  organizationId: providerId,
  userId: providerId,
  role: organizationRole,
});
const revokeInvitationInput = z.object({
  organizationId: providerId,
  invitationId: providerId,
  requestingUserId: providerId.optional(),
});

export type CreateClerkOrganizationInput = z.infer<typeof organizationInput>;
export type CreateClerkInvitationInput = z.infer<typeof invitationInput>;
export type ClerkMembershipInput = z.infer<typeof membershipInput>;
export type RevokeClerkInvitationInput = z.infer<typeof revokeInvitationInput>;

const dispatchMarkerSchema = z.object({
  source: z.literal(clerkInvitationDispatchSource),
  invitationId: z.string().uuid(),
  dispatchVersion: z.number().int().positive(),
  operation: z.enum(clerkInvitationDispatchOperations),
});

function parseInput<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(`${label} is invalid.`);
  }
  return result.data;
}

function parseProviderRole(role: unknown): ClerkOrganizationRole {
  const result = organizationRole.safeParse(role);
  if (!result.success) {
    throw new DependencyUnavailableError('Clerk returned an unsupported organization role.');
  }
  return result.data;
}

function parseProviderStatus(status: unknown): ClerkInvitationStatus | null {
  if (status === undefined || status === null) {
    return null;
  }
  const result = z.enum(clerkInvitationStatuses).safeParse(status);
  if (!result.success) {
    throw new DependencyUnavailableError('Clerk returned an unsupported invitation status.');
  }
  return result.data;
}

function parseProviderDate(value: unknown): Date {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DependencyUnavailableError('Clerk returned an invalid expiration timestamp.');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DependencyUnavailableError('Clerk returned an invalid expiration timestamp.');
  }
  return date;
}

function mapOrganization(
  organization: Awaited<ReturnType<ClerkProviderClient['organizations']['getOrganization']>>,
): ClerkOrganization {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdByUserId: organization.createdBy ?? null,
  };
}

function mapMembership(
  membership: Awaited<
    ReturnType<ClerkProviderClient['organizations']['createOrganizationMembership']>
  >,
  fallbackOrganizationId: string,
  fallbackUserId: string,
): ClerkOrganizationMembership {
  return {
    id: membership.id,
    organizationId: membership.organization.id || fallbackOrganizationId,
    userId: membership.publicUserData?.userId || fallbackUserId,
    role: parseProviderRole(membership.role),
  };
}

function mapInvitation(
  invitation: Awaited<
    ReturnType<ClerkProviderClient['organizations']['createOrganizationInvitation']>
  >,
): ClerkOrganizationInvitation {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    emailAddress: invitation.emailAddress,
    role: parseProviderRole(invitation.role),
    status: parseProviderStatus(invitation.status),
    expiresAt: parseProviderDate(invitation.expiresAt),
  };
}

function readDispatchMarker(value: unknown): ClerkInvitationDispatchMarker | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = (value as { privateMetadata?: unknown }).privateMetadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const marker = (metadata as { drezivo_dispatch?: unknown }).drezivo_dispatch;
  if (!marker || typeof marker !== 'object') return null;
  const raw = marker as {
    source?: unknown;
    invitation_id?: unknown;
    dispatch_version?: unknown;
    operation?: unknown;
  };
  const result = dispatchMarkerSchema.safeParse(
    {
      source: raw.source,
      invitationId: raw.invitation_id,
      dispatchVersion: raw.dispatch_version,
      operation: raw.operation,
    },
  );
  return result.success ? result.data : null;
}

function isProviderNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; statusCode?: unknown; errors?: unknown };
  if (record.status === 404 || record.statusCode === 404) return true;
  return (
    Array.isArray(record.errors) &&
    record.errors.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const code = (entry as { code?: unknown }).code;
      return code === 'resource_not_found' || code === 'not_found';
    })
  );
}

async function providerCall<T>(call: () => Promise<T>, conflictMessage?: string): Promise<T>;
async function providerCall<T>(
  call: () => Promise<T>,
  conflictMessage: string | undefined,
  notFoundValue: T,
): Promise<T>;
async function providerCall<T>(
  call: () => Promise<T>,
  conflictMessage?: string,
  notFoundValue?: T,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (notFoundValue !== undefined && isProviderNotFound(error)) return notFoundValue;
    if (error instanceof DependencyUnavailableError) {
      throw error;
    }
    if (conflictMessage && isProviderConflict(error)) {
      throw new StateConflictError(conflictMessage);
    }
    // Deliberately do not log or expose Clerk's raw body, request ID, or error message. The
    // global error handler can safely turn this typed failure into a generic 503 response.
    throw new DependencyUnavailableError('Clerk is temporarily unavailable. Please try again.');
  }
}

async function listProviderInvitations(
  client: ClerkProviderClient,
  organizationId: string,
): Promise<Awaited<ReturnType<ClerkProviderClient['organizations']['getOrganizationInvitationList']>>['data']> {
  const rows: Awaited<
    ReturnType<ClerkProviderClient['organizations']['getOrganizationInvitationList']>
  >['data'][number][] = [];
  const limit = 500;
  for (let offset = 0; offset <= 10000; offset += limit) {
    const page = await client.organizations.getOrganizationInvitationList({
      organizationId,
      limit,
      offset,
      status: [...clerkInvitationStatuses],
    });
    if (!page || !Array.isArray(page.data)) {
      throw new DependencyUnavailableError('Clerk returned an invalid invitation response.');
    }
    rows.push(...page.data);
    if (page.data.length < limit) return rows;
  }
  throw new DependencyUnavailableError('Clerk returned too many invitations.');
}

function isProviderConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; statusCode?: unknown; errors?: unknown };
  if (record.status === 409 || record.statusCode === 409) return true;
  return (
    Array.isArray(record.errors) &&
    record.errors.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as { code?: unknown };
      return item.code === 'form_param_taken';
    })
  );
}

export function createClerkServerAdapter(
  client: ClerkProviderClient = createClerkClient({
    secretKey: config.CLERK_SECRET_KEY,
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
  }),
): ClerkServerAdapter {
  return {
    async getUserVerificationState(userId) {
      const parsed = parseInput(providerId, userId, 'Clerk user ID');
      return providerCall(async () => {
        const user = await client.users.getUser(parsed);
        const primaryId = user.primaryEmailAddressId;
        const primary = primaryId
          ? user.emailAddresses.find((email) => email.id === primaryId)
          : undefined;
        return {
          primaryEmailVerified: primary?.verification?.status === 'verified',
        };
      });
    },

    async createOrganization(input) {
      const parsed = parseInput(organizationInput, input, 'Clerk organization');
      return providerCall(async () => {
        const params: Parameters<typeof client.organizations.createOrganization>[0] = {
          name: parsed.name,
          createdBy: parsed.createdByUserId,
        };
        if (parsed.onboardingMarker !== undefined) {
          params.privateMetadata = {
            drezivo_onboarding: {
              source: 'owner_onboarding_v1',
              account_id: parsed.onboardingMarker.accountId,
              attempt_id: parsed.onboardingMarker.attemptId,
            },
          };
        }
        return mapOrganization(await client.organizations.createOrganization(params));
      }, 'This organization could not be created because the identity provider reported a conflict.');
    },

    async getOrganization(organizationId) {
      const parsed = parseInput(providerId, organizationId, 'Clerk organization ID');
      return providerCall(async () =>
        mapOrganization(await client.organizations.getOrganization({ organizationId: parsed })),
      );
    },

    async deleteOrganizationIfPresent(organizationId) {
      const parsed = parseInput(providerId, organizationId, 'Clerk organization ID');
      return providerCall(
        async () => {
          await client.organizations.deleteOrganization(parsed);
          return true;
        },
        undefined,
        false,
      );
    },

    async getOrganizationMembership(organizationId, userId) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, userId: providerId }),
        { organizationId, userId },
        'Clerk organization membership',
      );
      return providerCall(async () => {
        const response = await client.organizations.getOrganizationMembershipList({
          organizationId: parsed.organizationId,
          userId: [parsed.userId],
          limit: 1,
        });
        if (!Array.isArray(response.data)) {
          throw new DependencyUnavailableError('Clerk returned an invalid membership response.');
        }
        const membership = response.data[0];
        return membership ? mapMembership(membership, parsed.organizationId, parsed.userId) : null;
      });
    },

    async createInvitation(input) {
      const parsed = parseInput(invitationInput, input, 'Clerk organization invitation');
      return providerCall(async () => {
        const params: Parameters<typeof client.organizations.createOrganizationInvitation>[0] = {
          organizationId: parsed.organizationId,
          emailAddress: parsed.emailAddress,
          role: parsed.role,
        };
        if (parsed.expiresInDays !== undefined) params.expiresInDays = parsed.expiresInDays;
        if (parsed.inviterUserId !== undefined) params.inviterUserId = parsed.inviterUserId;
        if (parsed.redirectUrl !== undefined) params.redirectUrl = parsed.redirectUrl;
        if (parsed.dispatchMarker !== undefined) {
          params.privateMetadata = {
            drezivo_dispatch: {
              source: parsed.dispatchMarker.source,
              invitation_id: parsed.dispatchMarker.invitationId,
              dispatch_version: parsed.dispatchMarker.dispatchVersion,
              operation: parsed.dispatchMarker.operation,
            },
          };
        }
        return mapInvitation(await client.organizations.createOrganizationInvitation(params));
      });
    },

    async findInvitation(organizationId, invitationId) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, invitationId: providerId }),
        { organizationId, invitationId },
        'Clerk organization invitation',
      );
      return providerCall(
        async () =>
          mapInvitation(
            await client.organizations.getOrganizationInvitation({
              organizationId: parsed.organizationId,
              invitationId: parsed.invitationId,
            }),
          ),
        undefined,
        null,
      );
    },

    async findInvitationByDispatchMarker(organizationId, marker) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, marker: dispatchMarkerSchema }),
        { organizationId, marker },
        'Clerk invitation dispatch marker',
      );
      return providerCall(async () => {
        const invitations = await listProviderInvitations(client, parsed.organizationId);
        const match = invitations.find((invitation) => {
          const candidate = readDispatchMarker(invitation);
          return (
            candidate?.source === parsed.marker.source &&
            candidate.invitationId === parsed.marker.invitationId &&
            candidate.dispatchVersion === parsed.marker.dispatchVersion &&
            candidate.operation === parsed.marker.operation
          );
        });
        return match ? mapInvitation(match) : null;
      });
    },

    async findInvitationsByInvitationId(organizationId, invitationId) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, invitationId: z.string().uuid() }),
        { organizationId, invitationId },
        'Clerk invitation dispatch identity',
      );
      return providerCall(async () => {
        const invitations = await listProviderInvitations(client, parsed.organizationId);
        return invitations
          .filter((invitation) => readDispatchMarker(invitation)?.invitationId === parsed.invitationId)
          .map((invitation) => mapInvitation(invitation));
      });
    },

    async getInvitation(organizationId, invitationId) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, invitationId: providerId }),
        { organizationId, invitationId },
        'Clerk organization invitation',
      );
      return providerCall(async () =>
        mapInvitation(
          await client.organizations.getOrganizationInvitation({
            organizationId: parsed.organizationId,
            invitationId: parsed.invitationId,
          }),
        ),
      );
    },

    async revokeInvitation(input) {
      const parsed = parseInput(revokeInvitationInput, input, 'Clerk organization invitation');
      return providerCall(async () => {
        const params: Parameters<typeof client.organizations.revokeOrganizationInvitation>[0] = {
          organizationId: parsed.organizationId,
          invitationId: parsed.invitationId,
        };
        if (parsed.requestingUserId !== undefined)
          params.requestingUserId = parsed.requestingUserId;
        return mapInvitation(await client.organizations.revokeOrganizationInvitation(params));
      });
    },

    async revokeInvitationIfPresent(input) {
      const parsed = parseInput(revokeInvitationInput, input, 'Clerk organization invitation');
      try {
        return await providerCall(
          async () => {
            const params: Parameters<
              typeof client.organizations.revokeOrganizationInvitation
            >[0] = {
              organizationId: parsed.organizationId,
              invitationId: parsed.invitationId,
            };
            if (parsed.requestingUserId !== undefined)
              params.requestingUserId = parsed.requestingUserId;
            return mapInvitation(await client.organizations.revokeOrganizationInvitation(params));
          },
          'Invitation is no longer revocable.',
          null,
        );
      } catch (error) {
        if (error instanceof StateConflictError) return null;
        throw error;
      }
    },

    async createMembership(input) {
      const parsed = parseInput(membershipInput, input, 'Clerk organization membership');
      return providerCall(async () =>
        mapMembership(
          await client.organizations.createOrganizationMembership(parsed),
          parsed.organizationId,
          parsed.userId,
        ),
      );
    },

    async updateMembership(input) {
      const parsed = parseInput(membershipInput, input, 'Clerk organization membership');
      return providerCall(async () =>
        mapMembership(
          await client.organizations.updateOrganizationMembership(parsed),
          parsed.organizationId,
          parsed.userId,
        ),
      );
    },

    async deleteMembership(input) {
      const parsed = parseInput(
        z.object({ organizationId: providerId, userId: providerId }),
        input,
        'Clerk organization membership',
      );
      return providerCall(async () =>
        mapMembership(
          await client.organizations.deleteOrganizationMembership(parsed),
          parsed.organizationId,
          parsed.userId,
        ),
      );
    },
  };
}
