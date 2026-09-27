/**
 * Builds openapi/drezivo.v1.yaml from the registered Zod schemas in `src/`.
 * TRD §4 — "Define OpenAPI before frontend integration." The document is
 * OUTPUT, never hand-edited (see the header this script writes into the
 * generated file, and README.md "Regenerating the OpenAPI document").
 *
 * Run: `npm run openapi:generate`. CI (`.github/workflows/release.yml`)
 * regenerates and diffs this file on every release — a diff means the
 * committed document no longer matches the schemas and the release fails.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OpenApiGeneratorV31, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { stringify as toYaml } from 'yaml';
import { z } from 'zod';

import {
  availabilityQuery,
  availabilityResult,
  clothingDetail,
  clothingImageFileIds,
  catalogueItem,
  catalogueQuery,
  centralPaymentsQuery,
  centralPaymentsResponse,
  changeSubscriptionPlanRequest,
  claimMembershipInvitationRequest,
  clerkWebhookInboxRecord,
  clerkWebhookEventType,
  closeTenantRequest,
  contractVersion,
  createMembershipInvitationRequest,
  createClothingRequest,
  createOwnerOnboardingRequest,
  membershipInvitation,
  membershipInvitationList,
  membershipInvitationParams,
  membershipInvitationStatus,
  onboardingActorContext,
  onboardingStatus,
  operatorActionResponse,
  operationalCalendarQuery,
  operationalCalendarResponse,
  planCode,
  resendMembershipInvitationRequest,
  cancelMembershipInvitationRequest,
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  chooseOnboardingPlanRequest,
  organizationOnboarding,
  errorEnvelope,
  filePurpose,
  fittingActionResponse,
  fittingCancelRequest,
  fittingClosureCreateRequest,
  fittingClosureListQuery,
  fittingClosureListResponse,
  fittingClosureMutationResponse,
  fittingClosureParams,
  fittingClosureRemoveRequest,
  fittingClosureRemoveResponse,
  fittingClosureUpdateRequest,
  fittingCompleteRequest,
  fittingConfirmRequest,
  fittingCreateRequest,
  fittingCreateResponse,
  fittingDetail,
  fittingGarmentPlanUpdateRequest,
  fittingGarmentPlanUpdateResponse,
  fittingIntakeQuery,
  fittingIntakeResponse,
  fittingListQuery,
  fittingListResponse,
  fittingNoShowRequest,
  fittingPaymentIntentCreateRequest,
  fittingPaymentIntentCreateResponse,
  fittingPaymentReceiptAttachRequest,
  fittingPaymentReceiptAttachResponse,
  fittingPaymentVerifyRequest,
  fittingPaymentVerifyResponse,
  fittingNoteUpdateRequest,
  fittingNoteUpdateResponse,
  fittingParams,
  fittingRejectRequest,
  fittingRescheduleRequest,
  fittingSettings,
  fittingSettingsUpdateRequest,
  fittingSettingsUpdateResponse,
  fittingState,
  fittingWeeklyHoursUpdateRequest,
  fittingWeeklyHoursUpdateResponse,
  guestReservationView,
  dashboardFittingSummaryResponse,
  holdIntentRequest,
  holdIntentResponse,
  itemDetail,
  paginatedResponse,
  paginationRequest,
  paymentReceiptSubmitRequest,
  paymentReceiptSubmitResponse,
  paymentMethodSettingsItem,
  paymentMethodSettingsList,
  updatePaymentMethodSettingsRequest,
  publicStorefront,
  refundCreateRequest,
  refundCreateResponse,
  replaceClothingImagesRequest,
  replaceClothingImagesResponse,
  reservationCancelRequest,
  reservationCancelResponse,
  reservationConfirmRequest,
  reservationConfirmResponse,
  reservationPickupRequest,
  reservationPickupResponse,
  reservationRescheduleRequest,
  reservationRescheduleResponse,
  reservationReturnRequest,
  reservationReturnResponse,
  staffReservationAvailabilityCalendarQuery,
  staffReservationAvailabilityCalendarResponse,
  staffReservationAvailabilityCheckQuery,
  staffReservationAvailabilityCheckResponse,
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  subscriptionStatus,
  subscriptionSummary,
  tenantBootstrapResponse,
  actorContext,
  workspaceList,
  workspaceSummary,
  successEnvelope,
  transferOwnershipRequest,
  uploadAuthorizationRequest,
  uploadAuthorizationResponse,
  verifyOnboardingPaymentRequest,
} from '../src';

// Must run before any `.openapi()` call. This package's own schemas never
// call `.openapi()` inline (it would couple every domain module to this
// generator) — extending the prototype here is enough for `registry.register`
// and `registerPath` to read component names and generate valid refs.
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// ---- Shared components -----------------------------------------------
registry.register('ErrorEnvelope', errorEnvelope);
registry.register('FittingState', fittingState);
registry.register('FittingDetail', fittingDetail);
registry.register('FittingListResponse', fittingListResponse);
registry.register('FittingSettings', fittingSettings);
// These are public contract components for Phase 1 onboarding routes. Register
// the boundary now without advertising paths that the API has not implemented.
registry.register('OnboardingStatus', onboardingStatus);
registry.register('PlanCode', planCode);
registry.register('SubscriptionStatus', subscriptionStatus);
registry.register('MembershipInvitationStatus', membershipInvitationStatus);
registry.register('ClerkWebhookEventType', clerkWebhookEventType);
registry.register('OrganizationOnboarding', organizationOnboarding);
registry.register('OnboardingActorContext', onboardingActorContext);
registry.register('MembershipInvitation', membershipInvitation);
registry.register('MembershipInvitationList', membershipInvitationList);
registry.register('SubscriptionSummary', subscriptionSummary);
registry.register('OperatorActionResponse', operatorActionResponse);
registry.register('ClerkWebhookInboxRecord', clerkWebhookInboxRecord);
registry.register('CreateOwnerOnboardingRequest', createOwnerOnboardingRequest);
registry.register('AbandonOwnerOnboardingRequest', abandonOwnerOnboardingRequest);
registry.register('ChooseOnboardingPlanRequest', chooseOnboardingPlanRequest);
registry.register('BootstrapTenantRequest', bootstrapTenantRequest);
registry.register('TenantBootstrapResponse', tenantBootstrapResponse);
registry.register('ActorContext', actorContext);
registry.register('WorkspaceSummary', workspaceSummary);
registry.register('WorkspaceList', workspaceList);
registry.register('CreateMembershipInvitationRequest', createMembershipInvitationRequest);
registry.register('MembershipInvitationParams', membershipInvitationParams);
registry.register('ResendMembershipInvitationRequest', resendMembershipInvitationRequest);
registry.register('CancelMembershipInvitationRequest', cancelMembershipInvitationRequest);
registry.register('ClaimMembershipInvitationRequest', claimMembershipInvitationRequest);
registry.register('ChangeSubscriptionPlanRequest', changeSubscriptionPlanRequest);
registry.register('PaymentMethodSettingsItem', paymentMethodSettingsItem);
registry.register('PaymentMethodSettingsList', paymentMethodSettingsList);
registry.register('UpdatePaymentMethodSettingsRequest', updatePaymentMethodSettingsRequest);
registry.register('VerifyOnboardingPaymentRequest', verifyOnboardingPaymentRequest);
registry.register('CloseTenantRequest', closeTenantRequest);
registry.register('TransferOwnershipRequest', transferOwnershipRequest);
registry.register('ClothingImageFileIds', clothingImageFileIds);
registry.register('CreateClothingRequest', createClothingRequest);
registry.register('ReplaceClothingImagesRequest', replaceClothingImagesRequest);
registry.register('ReplaceClothingImagesResponse', replaceClothingImagesResponse);
registry.register('ClothingDetail', clothingDetail);

const jsonError = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorEnvelope } },
});

const idempotencyKeyHeader = z.object({
  'Idempotency-Key': z.string().min(8).max(255),
});

// ---- owner onboarding ----------------------------------------------------
registry.registerPath({
  method: 'post',
  path: '/onboarding',
  tags: ['onboarding'],
  summary: 'Create the one pre-tenant owner onboarding journey.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: createOwnerOnboardingRequest } } },
  },
  responses: {
    201: {
      description: 'Clerk organization and local onboarding created.',
      content: { 'application/json': { schema: successEnvelope(organizationOnboarding) } },
    },
    200: {
      description: 'Existing unfinished onboarding resumed.',
      content: { 'application/json': { schema: successEnvelope(organizationOnboarding) } },
    },
    409: jsonError('An owned tenant or unfinished onboarding prevents creation.'),
    429: jsonError('Owner onboarding create rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/onboarding/{onboardingId}/plan',
  tags: ['onboarding'],
  summary: 'Persist the selected plan for an unfinished owner onboarding.',
  request: {
    params: z.object({ onboardingId: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: chooseOnboardingPlanRequest } } },
  },
  responses: {
    200: {
      description: 'Plan selection persisted on the onboarding journey.',
      content: { 'application/json': { schema: successEnvelope(organizationOnboarding) } },
    },
    404: jsonError('The onboarding was not found for this account.'),
    409: jsonError('The onboarding is not eligible for plan selection or the key is in progress.'),
    429: jsonError('Owner onboarding plan-selection rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/onboarding/{onboardingId}/bootstrap',
  tags: ['onboarding'],
  summary: 'Atomically provision the owner tenant from an eligible onboarding.',
  request: {
    params: z.object({ onboardingId: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: bootstrapTenantRequest } } },
  },
  responses: {
    201: {
      description: 'Tenant graph provisioned and trial started.',
      content: { 'application/json': { schema: successEnvelope(tenantBootstrapResponse) } },
    },
    404: jsonError('The onboarding was not found for this account.'),
    409: jsonError(
      'The onboarding is not eligible for bootstrap or a unique storefront URL could not be created.',
    ),
    429: jsonError('Owner tenant bootstrap rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/onboarding/current',
  tags: ['onboarding'],
  summary: 'Read the authenticated owner onboarding projection.',
  responses: {
    200: {
      description: 'Safe onboarding and account lifecycle context.',
      content: { 'application/json': { schema: successEnvelope(onboardingActorContext) } },
    },
    429: jsonError('Owner onboarding read rate limit exceeded.'),
  },
});

// ---- authenticated workspace context ------------------------------------
registry.registerPath({
  method: 'get',
  path: '/workspaces',
  tags: ['tenancy'],
  summary: 'List provisioned workspaces where the authenticated actor is an active member.',
  request: { query: paginationRequest },
  responses: {
    200: {
      description: 'Safe workspace switcher projections.',
      content: { 'application/json': { schema: successEnvelope(workspaceList) } },
    },
    429: jsonError('Workspace list rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/actor-context',
  tags: ['tenancy'],
  summary: 'Resolve the active Clerk organization to local membership, branch grants, and entitlements.',
  request: {
    headers: z.object({ 'X-Drezivo-Branch-Id': z.string().uuid().optional() }),
  },
  responses: {
    200: {
      description: 'Current actor and workspace context.',
      content: { 'application/json': { schema: successEnvelope(actorContext) } },
    },
    404: jsonError('The active workspace or branch could not be found.'),
    409: jsonError('The workspace access state is incomplete.'),
    429: jsonError('Actor context rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/onboarding/{onboardingId}/abandon',
  tags: ['onboarding'],
  summary: 'Abandon an unfinished owner onboarding while retaining history.',
  request: {
    params: z.object({ onboardingId: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: abandonOwnerOnboardingRequest } } },
  },
  responses: {
    200: {
      description: 'Onboarding abandoned or an identical abandonment replayed.',
      content: { 'application/json': { schema: successEnvelope(organizationOnboarding) } },
    },
    404: jsonError('The onboarding was not found for this account.'),
    409: jsonError('Provisioned onboarding cannot be abandoned, or the key is in progress.'),
    429: jsonError('Owner onboarding abandon rate limit exceeded.'),
  },
});

// ---- Owner Front Desk invitations ---------------------------------------
registry.registerPath({
  method: 'post',
  path: '/membership-invitations',
  tags: ['membership-invitations'],
  summary: 'Create or safely reuse one Owner-managed Front Desk invitation.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: createMembershipInvitationRequest } } },
  },
  responses: {
    200: {
      description: 'Invitation created or an existing pending invitation safely reused.',
      content: { 'application/json': { schema: successEnvelope(membershipInvitation) } },
    },
    403: jsonError('Only the active Owner can manage invitations.'),
    409: jsonError('The invitation state, seat capacity, or idempotency key is not valid.'),
    429: jsonError('Invitation mutation rate limit exceeded.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/membership-invitations',
  tags: ['membership-invitations'],
  summary: 'List safe Front Desk invitation state for the active tenant.',
  request: { query: paginationRequest },
  responses: {
    200: {
      description: 'Safe invitation projections without recipient or provider data.',
      content: { 'application/json': { schema: successEnvelope(membershipInvitationList) } },
    },
    403: jsonError('Only the active Owner can list invitations.'),
    429: jsonError('Invitation list rate limit exceeded.'),
  },
});

for (const action of ['resend', 'cancel'] as const) {
  registry.registerPath({
    method: 'post',
    path: `/membership-invitations/{invitationId}/${action}`,
    tags: ['membership-invitations'],
    summary: `${action === 'resend' ? 'Resend' : 'Cancel'} one Owner-managed Front Desk invitation.`,
    request: {
      params: membershipInvitationParams,
      headers: idempotencyKeyHeader,
      body: {
        content: {
          'application/json': {
            schema:
              action === 'resend' ? resendMembershipInvitationRequest : cancelMembershipInvitationRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Invitation state updated or an identical mutation replayed.',
        content: { 'application/json': { schema: successEnvelope(membershipInvitation) } },
      },
      403: jsonError('Only the active Owner can manage invitations.'),
      404: jsonError('Invitation not found for the active tenant.'),
      409: jsonError('The invitation state, seat capacity, or idempotency key is not valid.'),
      429: jsonError('Invitation mutation rate limit exceeded.'),
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/membership-invitations/{invitationId}/claim',
  tags: ['membership-invitations'],
  summary: 'Claim one accepted Clerk Front Desk invitation.',
  request: {
    params: membershipInvitationParams,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        'application/json': { schema: claimMembershipInvitationRequest },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation claimed and the authenticated actor context is returned.',
      content: { 'application/json': { schema: successEnvelope(actorContext) } },
    },
    404: jsonError('The invitation is not available.'),
    409: jsonError('The invitation claim or idempotency key is not valid.'),
    429: jsonError('Invitation claim rate limit exceeded.'),
    503: jsonError('The identity provider is temporarily unavailable.'),
  },
});

// ---- subscription lifecycle ---------------------------------------------
registry.registerPath({
  method: 'post',
  path: '/subscription/plan',
  tags: ['subscription'],
  summary: 'Change the owner workspace plan during the trial.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: changeSubscriptionPlanRequest } } },
  },
  responses: {
    200: {
      description: 'Trial plan changed or an identical plan change replayed.',
      content: { 'application/json': { schema: successEnvelope(subscriptionSummary) } },
    },
    403: jsonError('Only the active tenant owner can change the trial plan.'),
    409: jsonError('The trial state, idempotency key, or requested plan is not valid.'),
    429: jsonError('Subscription plan change rate limit exceeded.'),
  },
});

// ---- payment method settings --------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/payment-methods',
  tags: ['payments'],
  summary: 'List tenant-owned payment methods and storefront readiness.',
  responses: {
    200: {
      description: 'Payment methods available to the payment-management settings UI.',
      content: { 'application/json': { schema: successEnvelope(paymentMethodSettingsList) } },
    },
    403: jsonError('Payment management permission is required.'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/payment-methods/{paymentMethodId}',
  tags: ['payments'],
  summary: 'Update staff availability and storefront intent for one payment method.',
  request: {
    params: z.object({ paymentMethodId: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: updatePaymentMethodSettingsRequest } } },
  },
  responses: {
    200: {
      description: 'Payment method settings updated or replayed.',
      content: { 'application/json': { schema: successEnvelope(paymentMethodSettingsItem) } },
    },
    403: jsonError('Payment management permission is required.'),
    404: jsonError('The payment method could not be found for this workspace.'),
    409: jsonError('The payment method changed or an identical request is in progress.'),
    422: jsonError('The payment method settings are invalid.'),
  },
});

// ---- storefront ---------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/public/stores/{slug}',
  tags: ['storefront'],
  summary: 'Published storefront projection (TRD §4).',
  request: { params: z.object({ slug: z.string().min(1) }) },
  responses: {
    200: {
      description: 'Published storefront.',
      content: { 'application/json': { schema: successEnvelope(publicStorefront) } },
    },
    404: jsonError('No published storefront at this slug.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/public/stores/{slug}/catalogue',
  tags: ['storefront'],
  summary: 'Search/filter the published catalogue (PRD §4 FR16).',
  request: {
    params: z.object({ slug: z.string().min(1) }),
    query: catalogueQuery,
  },
  responses: {
    200: {
      description: 'A page of catalogue items.',
      content: { 'application/json': { schema: successEnvelope(paginatedResponse(catalogueItem)) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/public/stores/{slug}/products/{productId}',
  tags: ['storefront'],
  summary: 'Style detail with variant options (PRD §4 FR17).',
  request: { params: z.object({ slug: z.string().min(1), productId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Style and its variants.',
      content: { 'application/json': { schema: successEnvelope(itemDetail) } },
    },
    404: jsonError('No published product at this id.'),
  },
});

// ---- availability ---------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/public/stores/{slug}/availability',
  tags: ['availability'],
  summary: 'Non-binding availability preview for one variant/date range (TRD §4).',
  request: {
    params: z.object({ slug: z.string().min(1) }),
    query: availabilityQuery,
  },
  responses: {
    200: {
      description: 'Availability preview. Never a capacity guarantee (TRD §5).',
      content: { 'application/json': { schema: successEnvelope(availabilityResult) } },
    },
  },
});

// ---- reservations ---------------------------------------------------------
registry.registerPath({
  method: 'post',
  path: '/public/stores/{slug}/holds',
  tags: ['reservations'],
  summary: 'Create an exclusive, expiring hold before payment instructions are shown (TRD §5).',
  request: {
    params: z.object({ slug: z.string().min(1) }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: holdIntentRequest } } },
  },
  responses: {
    201: {
      description: 'Hold created.',
      content: { 'application/json': { schema: successEnvelope(holdIntentResponse) } },
    },
    409: jsonError('The requested asset/interval is no longer available (CAPACITY_CONFLICT).'),
    422: jsonError('Validation failed.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/reservations/availability-calendar',
  tags: ['reservations', 'availability'],
  summary: 'Staff variant-aware calendar availability preview for one bounded date window.',
  request: { query: staffReservationAvailabilityCalendarQuery },
  responses: {
    200: {
      description: 'Advisory branch-local day availability. Never a capacity guarantee.',
      content: {
        'application/json': { schema: successEnvelope(staffReservationAvailabilityCalendarResponse) },
      },
    },
    403: jsonError('Reservation management permission is required.'),
    404: jsonError('The active clothing variant could not be found.'),
    409: jsonError('The active branch cannot resolve the current reservation quote context.'),
    422: jsonError('The bounded availability calendar query is invalid.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/reservations/availability-check',
  tags: ['reservations', 'availability'],
  summary: 'Staff exact-time availability and rental-price preview before reservation creation.',
  request: { query: staffReservationAvailabilityCheckQuery },
  responses: {
    200: {
      description: 'Exact timestamp preview. Reservation creation still revalidates under asset locks.',
      content: {
        'application/json': { schema: successEnvelope(staffReservationAvailabilityCheckResponse) },
      },
    },
    403: jsonError('Reservation management permission is required.'),
    404: jsonError('The active clothing variant could not be found.'),
    409: jsonError('The requested fixed-duration rental is shorter than the configured minimum.'),
    422: jsonError('The exact availability interval is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations',
  tags: ['reservations'],
  summary: 'Staff/walk-in booking, same allocator as the public hold (TRD §4).',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: staffReservationCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Reservation created.',
      content: { 'application/json': { schema: successEnvelope(staffReservationCreateResponse) } },
    },
    409: jsonError('CAPACITY_CONFLICT.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations/{id}/confirm',
  tags: ['reservations'],
  summary: 'Merchant confirmation — atomic with verified-payment posting (TRD §5).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: reservationConfirmRequest } } },
  },
  responses: {
    200: {
      description: 'Reservation confirmed.',
      content: { 'application/json': { schema: successEnvelope(reservationConfirmResponse) } },
    },
    409: jsonError('STATE_CONFLICT — stale version, expired hold, or already decided.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations/{id}/reschedule',
  tags: ['reservations'],
  summary: 'Atomic allocation replacement; failure preserves the original booking (TRD §5).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: reservationRescheduleRequest } } },
  },
  responses: {
    200: {
      description: 'Reservation rescheduled.',
      content: { 'application/json': { schema: successEnvelope(reservationRescheduleResponse) } },
    },
    409: jsonError('CAPACITY_CONFLICT on the new interval, or STATE_CONFLICT on stale version.'),
    422: jsonError('Price changed but accept_price_change was not set.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations/{id}/pickup',
  tags: ['reservations'],
  summary: 'Record physical handover (TRD §4).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: reservationPickupRequest } } },
  },
  responses: {
    200: {
      description: 'Pickup recorded.',
      content: { 'application/json': { schema: successEnvelope(reservationPickupResponse) } },
    },
    409: jsonError('STATE_CONFLICT — asset not ready or reservation not confirmed.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations/{id}/return',
  tags: ['reservations'],
  summary: 'Record actual return; duplicate-safe custody event (TRD §4).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: reservationReturnRequest } } },
  },
  responses: {
    200: {
      description: 'Return recorded.',
      content: { 'application/json': { schema: successEnvelope(reservationReturnResponse) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/reservations/{id}/cancel',
  tags: ['reservations'],
  summary: 'Cancel a reservation before handover (Data-Model §6).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: reservationCancelRequest } } },
  },
  responses: {
    200: {
      description: 'Reservation cancelled.',
      content: { 'application/json': { schema: successEnvelope(reservationCancelResponse) } },
    },
    409: jsonError('STATE_CONFLICT — already picked up, cannot cancel into available.'),
  },
});

// ---- operations ------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/calendar',
  tags: ['operations'],
  summary: 'Read one bounded operational calendar projection from authoritative reservations and fittings.',
  request: { query: operationalCalendarQuery },
  responses: {
    200: {
      description: 'Reservation pickup/return and fitting events for the active branch.',
      content: { 'application/json': { schema: successEnvelope(operationalCalendarResponse) } },
    },
    403: jsonError('Operational schedule access is required.'),
    422: jsonError('The calendar query is invalid or exceeds the bounded window.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/dashboard/fittings-summary',
  tags: ['operations'],
  summary: 'Read branch-local fitting operational counts for today and the next seven days.',
  responses: {
    200: {
      description: 'Authoritative fitting counts only; no utilization or revenue analytics.',
      content: { 'application/json': { schema: successEnvelope(dashboardFittingSummaryResponse) } },
    },
    403: jsonError('Operational schedule access is required.'),
    404: jsonError('The active branch could not be found.'),
  },
});

// ---- fittings --------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/fittings',
  tags: ['fittings'],
  summary: 'List staff fittings for the active branch with bounded operational filters.',
  request: { query: fittingListQuery },
  responses: {
    200: {
      description: 'Paginated fitting appointments for the active branch.',
      content: { 'application/json': { schema: successEnvelope(fittingListResponse) } },
    },
    403: jsonError('Fitting read permission is required.'),
    422: jsonError('The fitting list query is invalid.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/fittings/{id}',
  tags: ['fittings'],
  summary: 'Read one authoritative staff fitting projection.',
  request: { params: fittingParams },
  responses: {
    200: {
      description: 'Fitting detail with customer, garments, fee/payment summary and allowed actions.',
      content: { 'application/json': { schema: successEnvelope(fittingDetail) } },
    },
    403: jsonError('Fitting read permission is required.'),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/fittings/intake-options',
  tags: ['fittings'],
  summary: 'Search bounded existing-customer options for staff fitting intake.',
  request: { query: fittingIntakeQuery },
  responses: {
    200: {
      description:
        'Safe existing-customer options for deliberate staff selection; matches are advisory only.',
      content: { 'application/json': { schema: successEnvelope(fittingIntakeResponse) } },
    },
    403: jsonError('Fitting create permission is required.'),
    422: jsonError('The fitting intake query is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings',
  tags: ['fittings'],
  summary: 'Create one pending staff fitting and atomically claim capacity/guaranteed garments.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Pending fitting created with authoritative fee and guarantee results.',
      content: { 'application/json': { schema: successEnvelope(fittingCreateResponse) } },
    },
    403: jsonError('Fitting create permission is required.'),
    409: jsonError(
      'STATE_CONFLICT, SCHEDULE_CONFLICT, CAPACITY_CONFLICT, ASSET_UNAVAILABLE, or IDEMPOTENCY_KEY_REUSED.',
    ),
    422: jsonError('The fitting create request is invalid.'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/fittings/{id}/note',
  tags: ['fittings'],
  summary: 'Update the bounded internal staff note without changing scheduling or lifecycle state.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingNoteUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Internal note updated.',
      content: { 'application/json': { schema: successEnvelope(fittingNoteUpdateResponse) } },
    },
    403: jsonError('Fitting update permission is required.'),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
    409: jsonError('STATE_CONFLICT or IDEMPOTENCY_KEY_REUSED.'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/fittings/{id}/garments',
  tags: ['fittings'],
  summary: 'Atomically replace the future fitting garment preference/guarantee plan.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingGarmentPlanUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Garment plan replaced without exposing asset-selection authority to the client.',
      content: { 'application/json': { schema: successEnvelope(fittingGarmentPlanUpdateResponse) } },
    },
    403: jsonError('Fitting update permission is required.'),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
    409: jsonError('STATE_CONFLICT, ASSET_UNAVAILABLE, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The garment plan is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings/{id}/reschedule',
  tags: ['fittings'],
  summary: 'Atomically claim a replacement fitting period before releasing the current one.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingRescheduleRequest } } },
  },
  responses: {
    200: {
      description: 'Fitting rescheduled; the original remains unchanged if this command cannot win.',
      content: { 'application/json': { schema: successEnvelope(fittingActionResponse) } },
    },
    403: jsonError('Fitting reschedule permission is required.'),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
    409: jsonError(
      'STATE_CONFLICT, SCHEDULE_CONFLICT, CAPACITY_CONFLICT, ASSET_UNAVAILABLE, or IDEMPOTENCY_KEY_REUSED.',
    ),
    422: jsonError('The replacement start time is invalid.'),
  },
});

for (const action of ['confirm', 'reject', 'cancel', 'complete', 'no-show'] as const) {
  const requestSchema =
    action === 'confirm'
      ? fittingConfirmRequest
      : action === 'reject'
        ? fittingRejectRequest
        : action === 'cancel'
          ? fittingCancelRequest
          : action === 'complete'
            ? fittingCompleteRequest
            : fittingNoShowRequest;
  registry.registerPath({
    method: 'post',
    path: `/fittings/{id}/${action}`,
    tags: ['fittings'],
    summary:
      action === 'no-show'
        ? 'Mark a confirmed fitting no-show after scheduled start.'
        : `${action.charAt(0).toUpperCase() + action.slice(1)} one fitting through its guarded lifecycle command.`,
    request: {
      params: fittingParams,
      headers: idempotencyKeyHeader,
      body: { content: { 'application/json': { schema: requestSchema } } },
    },
    responses: {
      200: {
        description: 'Fitting lifecycle state updated.',
        content: { 'application/json': { schema: successEnvelope(fittingActionResponse) } },
      },
      403: jsonError('The authenticated staff actor cannot perform this fitting action.'),
      404: jsonError('The fitting was not found for the active tenant/branch.'),
      409: jsonError('STATE_CONFLICT, STALE_VERSION, or IDEMPOTENCY_KEY_REUSED.'),
      422: jsonError('The fitting action request is invalid.'),
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/fittings/{id}/payment',
  tags: ['fittings', 'payments'],
  summary: 'Create the canonical pending payment intent for a positive fitting-fee obligation.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingPaymentIntentCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Pending fitting-fee payment intent created; no money is implied collected.',
      content: { 'application/json': { schema: successEnvelope(fittingPaymentIntentCreateResponse) } },
    },
    403: jsonError('Fitting operation permission is required.'),
    404: jsonError('The fitting or payment method was not found for the active tenant/branch.'),
    409: jsonError('STATE_CONFLICT or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting payment request is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings/{id}/payment-receipt',
  tags: ['fittings', 'payments'],
  summary: 'Attach immutable payment evidence to the fitting payment without marking funds verified.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingPaymentReceiptAttachRequest } } },
  },
  responses: {
    200: {
      description: 'Evidence attached; payment collection state remains independent.',
      content: { 'application/json': { schema: successEnvelope(fittingPaymentReceiptAttachResponse) } },
    },
    403: jsonError('Fitting operation permission is required.'),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
    409: jsonError('STATE_CONFLICT, PAYMENT_PREREQUISITE_FAILED, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting payment receipt request is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings/{id}/verify-payment',
  tags: ['fittings', 'payments'],
  summary: 'Explicitly verify actual fitting-fee collection without changing fitting lifecycle state.',
  request: {
    params: fittingParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingPaymentVerifyRequest } } },
  },
  responses: {
    200: {
      description: 'Payment verified and allocated to the immutable fitting-fee charge.',
      content: { 'application/json': { schema: successEnvelope(fittingPaymentVerifyResponse) } },
    },
    403: jsonError(
      'payments.manage and evidence.verify are required in addition to fitting operation access.',
    ),
    404: jsonError('The fitting was not found for the active tenant/branch.'),
    409: jsonError('STATE_CONFLICT, PAYMENT_PREREQUISITE_FAILED, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting payment verification request is invalid.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/fittings/settings',
  tags: ['fittings'],
  summary: 'Read branch fitting enabled state, simultaneous capacity, strict duration, fee and weekly hours.',
  responses: {
    200: {
      description: 'Current branch fitting settings without hidden capacity-slot identities.',
      content: { 'application/json': { schema: successEnvelope(fittingSettings) } },
    },
    403: jsonError('Fitting settings read permission is required.'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/fittings/settings',
  tags: ['fittings'],
  summary: 'Owner-only update of branch fitting enabled state, capacity, strict duration and fixed fee.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingSettingsUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Scalar fitting settings updated.',
      content: { 'application/json': { schema: successEnvelope(fittingSettingsUpdateResponse) } },
    },
    403: jsonError('Only Owner may mutate fitting configuration.'),
    409: jsonError('STATE_CONFLICT, SCHEDULE_CONFLICT, STALE_VERSION, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting settings request is invalid.'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/fittings/settings/hours',
  tags: ['fittings'],
  summary: 'Owner-only full replacement of recurring branch fitting windows.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingWeeklyHoursUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Weekly fitting windows updated; gaps represent recurring breaks.',
      content: { 'application/json': { schema: successEnvelope(fittingWeeklyHoursUpdateResponse) } },
    },
    403: jsonError('Only Owner may mutate fitting configuration.'),
    409: jsonError('SCHEDULE_CONFLICT, STALE_VERSION, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The weekly fitting-hours request is invalid.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/fittings/closures',
  tags: ['fittings'],
  summary: 'List date-specific fitting closures in one bounded period window.',
  request: { query: fittingClosureListQuery },
  responses: {
    200: {
      description: 'Paginated date-specific fitting closures.',
      content: { 'application/json': { schema: successEnvelope(fittingClosureListResponse) } },
    },
    403: jsonError('Fitting settings read permission is required.'),
    422: jsonError('The closure list window is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings/closures',
  tags: ['fittings'],
  summary: 'Owner-only creation of a date-specific fitting closure.',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingClosureCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Fitting closure created.',
      content: { 'application/json': { schema: successEnvelope(fittingClosureMutationResponse) } },
    },
    403: jsonError('Only Owner may mutate fitting configuration.'),
    409: jsonError('SCHEDULE_CONFLICT, STALE_VERSION, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting closure request is invalid.'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/fittings/closures/{closureId}',
  tags: ['fittings'],
  summary: 'Owner-only update of one date-specific fitting closure.',
  request: {
    params: fittingClosureParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingClosureUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Fitting closure updated.',
      content: { 'application/json': { schema: successEnvelope(fittingClosureMutationResponse) } },
    },
    403: jsonError('Only Owner may mutate fitting configuration.'),
    404: jsonError('The fitting closure was not found for the active tenant/branch.'),
    409: jsonError('SCHEDULE_CONFLICT, STALE_VERSION, or IDEMPOTENCY_KEY_REUSED.'),
    422: jsonError('The fitting closure request is invalid.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/fittings/closures/{closureId}/remove',
  tags: ['fittings'],
  summary: 'Owner-only removal of one date-specific fitting closure.',
  request: {
    params: fittingClosureParams,
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: fittingClosureRemoveRequest } } },
  },
  responses: {
    200: {
      description: 'Fitting closure removed.',
      content: { 'application/json': { schema: successEnvelope(fittingClosureRemoveResponse) } },
    },
    403: jsonError('Only Owner may mutate fitting configuration.'),
    404: jsonError('The fitting closure was not found for the active tenant/branch.'),
    409: jsonError('STALE_VERSION or IDEMPOTENCY_KEY_REUSED.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/guest/reservations/{id}',
  tags: ['guest'],
  summary: "Guest's own booking summary; `no-store` (TRD §4).",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Reservation view scoped to the presented capability token.',
      content: { 'application/json': { schema: successEnvelope(guestReservationView) } },
    },
    404: jsonError('Concealed: invalid, expired, or revoked capability token.'),
  },
});

// ---- finance ---------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/payments',
  tags: ['finance'],
  summary: 'List a bounded central payment projection across reservation and fitting sources.',
  request: { query: centralPaymentsQuery },
  responses: {
    200: {
      description: 'Payments for the active branch with source identity and safe evidence/refund status.',
      content: { 'application/json': { schema: successEnvelope(centralPaymentsResponse) } },
    },
    403: jsonError('payments.view permission is required.'),
    422: jsonError('The payments query is invalid or exceeds the bounded window.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/guest/reservations/{id}/receipts',
  tags: ['finance'],
  summary: 'Attach payment evidence to a reservation (TRD §4).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: paymentReceiptSubmitRequest } } },
  },
  responses: {
    201: {
      description: 'Evidence attached.',
      content: { 'application/json': { schema: successEnvelope(paymentReceiptSubmitResponse) } },
    },
    409: jsonError('STATE_CONFLICT — hold already expired.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/refunds',
  tags: ['finance'],
  summary: 'Refund instruction; locked residual amount (TRD §4, §6).',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: refundCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Refund instruction recorded.',
      content: { 'application/json': { schema: successEnvelope(refundCreateResponse) } },
    },
    409: jsonError('CAPACITY_CONFLICT — requested amount exceeds the remaining refundable balance.'),
  },
});

// ---- files ---------------------------------------------------------
registry.registerPath({
  method: 'post',
  path: '/uploads',
  tags: ['files'],
  summary: 'Authorize a direct-to-storage upload (TRD §4, §7).',
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { 'application/json': { schema: uploadAuthorizationRequest } } },
  },
  responses: {
    201: {
      description: 'Upload authorized.',
      content: { 'application/json': { schema: successEnvelope(uploadAuthorizationResponse) } },
    },
    422: jsonError(`Validation failed — see ${filePurpose.options.join(', ')} for allowed purposes.`),
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Drezivo API',
    version: contractVersion,
    description:
      'Generated from @drezivo/contracts Zod schemas. Do not hand-edit — run `npm run openapi:generate`.',
  },
  servers: [{ url: '/api/v1' }],
});

const header = [
  '# GENERATED FILE — do not hand-edit.',
  '# Source of truth: src/**/*.ts (Zod schemas), built by openapi/generate.ts.',
  '# Regenerate with `npm run openapi:generate`; CI fails the release if this file drifts',
  '# from the schemas (.github/workflows/release.yml).',
  '',
].join('\n');

writeFileSync(resolve(process.cwd(), 'openapi/drezivo.v1.yaml'), header + toYaml(document));
