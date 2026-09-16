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
  catalogueItem,
  catalogueQuery,
  changeSubscriptionPlanRequest,
  claimMembershipInvitationRequest,
  clerkWebhookInboxRecord,
  clerkWebhookEventType,
  closeTenantRequest,
  contractVersion,
  createMembershipInvitationRequest,
  createOwnerOnboardingRequest,
  membershipInvitation,
  membershipInvitationParams,
  membershipInvitationStatus,
  onboardingActorContext,
  onboardingStatus,
  operatorActionResponse,
  planCode,
  resendMembershipInvitationRequest,
  cancelMembershipInvitationRequest,
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  chooseOnboardingPlanRequest,
  organizationOnboarding,
  errorEnvelope,
  filePurpose,
  guestReservationView,
  holdIntentRequest,
  holdIntentResponse,
  itemDetail,
  paginatedResponse,
  paymentReceiptSubmitRequest,
  paymentReceiptSubmitResponse,
  publicStorefront,
  refundCreateRequest,
  refundCreateResponse,
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
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  subscriptionStatus,
  subscriptionSummary,
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
registry.register('SubscriptionSummary', subscriptionSummary);
registry.register('OperatorActionResponse', operatorActionResponse);
registry.register('ClerkWebhookInboxRecord', clerkWebhookInboxRecord);
registry.register('CreateOwnerOnboardingRequest', createOwnerOnboardingRequest);
registry.register('AbandonOwnerOnboardingRequest', abandonOwnerOnboardingRequest);
registry.register('ChooseOnboardingPlanRequest', chooseOnboardingPlanRequest);
registry.register('BootstrapTenantRequest', bootstrapTenantRequest);
registry.register('CreateMembershipInvitationRequest', createMembershipInvitationRequest);
registry.register('MembershipInvitationParams', membershipInvitationParams);
registry.register('ResendMembershipInvitationRequest', resendMembershipInvitationRequest);
registry.register('CancelMembershipInvitationRequest', cancelMembershipInvitationRequest);
registry.register('ClaimMembershipInvitationRequest', claimMembershipInvitationRequest);
registry.register('ChangeSubscriptionPlanRequest', changeSubscriptionPlanRequest);
registry.register('VerifyOnboardingPaymentRequest', verifyOnboardingPaymentRequest);
registry.register('CloseTenantRequest', closeTenantRequest);
registry.register('TransferOwnershipRequest', transferOwnershipRequest);

const jsonError = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorEnvelope } },
});

const idempotencyKeyHeader = z.object({
  'Idempotency-Key': z.string().min(8).max(255),
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
