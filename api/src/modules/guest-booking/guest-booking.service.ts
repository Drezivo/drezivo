import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  guestFittingCreated,
  guestReceiptUploadResponse,
  guestReservationView,
  type GuestFittingCreated,
  type GuestFittingRequest,
  type GuestReceiptUploadRequest,
  type GuestReceiptUploadResponse,
  type GuestReservationCreated,
  type GuestReservationRequest,
  type GuestReservationView,
} from '@drezivo/contracts';

import { config } from '../../config/index.js';
import { pool, withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import {
  CapacityConflictError,
  DependencyUnavailableError,
  HoldExpiredError,
  NotFoundError,
  ScheduleConflictError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import { guestTokenFor } from '../../shared/guest-token.js';
import { digestRecipientEmail } from '../../shared/protected-recipient.js';

export { guestTokenFor };
import { acceptFileObject, insertPendingFile, rejectFileObject } from '../files/files.repository.js';
import { validateUploadedObject } from '../files/files.service.js';
import {
  claimFittingCapacitySlot,
  createFittingAppointmentBase,
  ensureFittingCapacitySlots,
  lockFittingCreateSettings,
  validateFittingScheduleForCreate,
} from '../fittings/fittings.command.repository.js';
import { emailNotifications } from '../notifications/email-notifications.js';
import { appendReservationOutboxEvent } from '../reservations/reservations.command.repository.js';
import {
  claimReservationAsset,
  createHeldReservation,
  isAllocationOverlapViolation,
} from '../reservations/reservations.command.service.js';
import {
  attachAcceptedReservationReceipt,
  lockReservationForReview,
  lockReservationPaymentForReview,
  markReceiptUnderReview,
  submitReservationForReview,
} from '../reservations/reservations.review.repository.js';
import { toDocument } from '../storefront-cms/storefront-cms.service.js';
import { storefrontMediaSigner } from '../storefront/storefront-media.js';
import {
  isVisibleVariant,
  readStoreCore,
  readStorefrontPaymentMethods,
  resolvePublishedStore,
  type PublishedStore,
} from '../storefront/storefront.repository.js';
import { assertCheckoutRules } from './checkout-rules.js';
import {
  appendGuestAudit,
  findOrCreateGuestCustomer,
  insertGuestAccessToken,
  readGuestReservation,
  readGuestTokenScopes,
  readReceiptFile,
  type GuestReservationRow,
} from './guest-booking.repository.js';
import { guestVerificationService, tokenHash, type GuestVerificationService } from './guest-verification.service.js';

const STORE_NOT_FOUND = 'This store is not available.';
const GUEST_NOT_FOUND = 'This booking link is not valid or has expired.';
const GUEST_TOKEN_DAYS_AFTER_RETURN = 30;
const RECEIPT_UPLOAD_SECONDS = 10 * 60;
const RECEIPT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const EXCLUSION_VIOLATION = '23P01';

const guestActorKey = (email: string): string => `guest:${digestRecipientEmail(email).slice(0, 16)}`;

export interface GuestRequestMeta {
  requestId: string;
  idempotencyKey: string;
}

export class GuestBookingService {
  constructor(
    private readonly verification: GuestVerificationService = guestVerificationService,
    private readonly storage: ObjectStorage = objectStorage,
  ) {}

  /** Verified guest places a 15-minute hold on one size for whole days, then pays and uploads a receipt. */
  async createReservation(slug: string, meta: GuestRequestMeta, request: GuestReservationRequest): Promise<CommandResult<GuestReservationCreated>> {
    const store = await this.requireStore(slug);
    const result = await withTenantTransaction(store.tenantId, guestActorKey(request.email), (client) =>
      runIdempotentCommand(
        client,
        {
          tenantId: store.tenantId,
          principalKey: `guest:${digestRecipientEmail(request.email)}`,
          operation: 'reservation.guest.create',
          intentKey: meta.idempotencyKey,
          requestId: meta.requestId,
        },
        { ...request, verification_token: tokenHash(request.verification_token) },
        async () => {
          await this.verification.consume(client, store.tenantId, request.email, request.verification_token);
          const core = await readStoreCore(client, store);
          if (!core) throw new NotFoundError(STORE_NOT_FOUND);
          assertCheckoutRules(toDocument(core).checkout, request, core.timezone);

          const methods = await readStorefrontPaymentMethods(client, store.tenantId);
          if (!methods.some((method) => method.id === request.payment_method_id)) {
            throw new ValidationError('Choose one of the payment methods this shop accepts online.');
          }
          if (!(await isVisibleVariant(client, store.tenantId, request.variant_id))) {
            throw new NotFoundError('This item is no longer available.');
          }

          try {
            const { quote, assetId } = await claimReservationAsset(client, {
              tenantId: store.tenantId,
              branchId: store.branchId,
              requestId: meta.requestId,
              request: {
                variant_id: request.variant_id,
                requested_interval: request.requested_interval,
                ...(request.event_date ? { event_date: request.event_date } : {}),
                fulfillment_method: request.fulfillment_method,
                payment_method_id: request.payment_method_id,
              },
            });
            const customer = await findOrCreateGuestCustomer(client, store.tenantId, request.email, request.customer);
            const { graph } = await createHeldReservation(client, {
              tenantId: store.tenantId,
              branchId: store.branchId,
              requestId: meta.requestId,
              actor: { kind: 'guest', key: guestActorKey(request.email) },
              eventDate: request.event_date,
              fulfillmentMethod: request.fulfillment_method,
              quote,
              assetId,
              customer,
            });
            const expiresAt = new Date(new Date(quote.due_at).getTime() + GUEST_TOKEN_DAYS_AFTER_RETURN * 86_400_000);
            await insertGuestAccessToken(client, {
              tenantId: store.tenantId,
              reservationId: graph.reservation_id,
              tokenHash: tokenHash(guestTokenFor(graph.reservation_id)),
              expiresAt,
            });
            return {
              reservation: await this.view(client, store.tenantId, graph.reservation_id),
              guest_token_expires_at: expiresAt.toISOString(),
            };
          } catch (error) {
            if (isAllocationOverlapViolation(error)) {
              throw new CapacityConflictError('Someone just reserved this size for those dates. Choose other dates.');
            }
            throw error;
          }
        },
        201,
      ),
    );
    // The token is re-derived rather than stored, so replays return it too.
    if (!result.body.success) return result as CommandResult<GuestReservationCreated>;
    const data = result.body.data as Omit<GuestReservationCreated, 'guest_token'>;
    return {
      status: result.status,
      body: { ...result.body, data: { ...data, guest_token: guestTokenFor(data.reservation.id) } },
    };
  }

  async getReservation(reservationId: string, bearer: string): Promise<GuestReservationView> {
    const tenantId = await this.resolveGuestTenant(reservationId, bearer);
    return withTenantTransaction(tenantId, 'guest', async (client) => {
      await this.requireScope(client, tenantId, reservationId, bearer, 'view_status');
      return this.view(client, tenantId, reservationId);
    });
  }

  async authorizeReceiptUpload(reservationId: string, bearer: string, request: GuestReceiptUploadRequest): Promise<GuestReceiptUploadResponse> {
    if (!config.OBJECT_STORAGE_UPLOADS_ENABLED) {
      throw new DependencyUnavailableError('File uploads are temporarily unavailable.');
    }
    const tenantId = await this.resolveGuestTenant(reservationId, bearer);
    return withTenantTransaction(tenantId, 'guest', async (client) => {
      await this.requireScope(client, tenantId, reservationId, bearer, 'submit_evidence');
      const reservation = await readGuestReservation(client, tenantId, reservationId);
      if (!reservation) throw new NotFoundError(GUEST_NOT_FOUND);
      assertAwaitingReceipt(reservation);

      const fileId = randomUUID();
      const storageKey = receiptStorageKey(tenantId, reservationId, fileId);
      const authorization = await this.storage.authorizeUpload({
        storageKey,
        contentType: request.content_type,
        expiresInSeconds: RECEIPT_UPLOAD_SECONDS,
      });
      await insertPendingFile(client, {
        id: fileId,
        tenantId,
        purpose: 'payment_receipt',
        storageKey,
        sha256: request.sha256,
        mimeType: request.content_type,
        byteSize: request.byte_size,
        uploadExpiresAt: authorization.expiresAt,
      });
      return guestReceiptUploadResponse.parse({
        file_id: fileId,
        upload_url: authorization.uploadUrl,
        required_headers: authorization.requiredHeaders,
        expires_at: authorization.expiresAt.toISOString(),
      });
    });
  }

  /** Verifies the uploaded file, attaches it, and moves the hold to owner review in one transaction. */
  async submitReceipt(reservationId: string, bearer: string, meta: GuestRequestMeta, fileId: string): Promise<CommandResult<GuestReservationView>> {
    const tenantId = await this.resolveGuestTenant(reservationId, bearer);
    const before = await withTenantTransaction(tenantId, 'guest', (client) => readReceiptFile(client, tenantId, fileId));
    if (!before || !before.storage_key.startsWith(receiptStorageKey(tenantId, reservationId, ''))) {
      throw new ValidationError('Upload the receipt again before submitting.');
    }
    const uploaded = before.lifecycle_status === 'accepted'
      ? null
      : await this.storage.inspectUploadedObject(before.storage_key, RECEIPT_UPLOAD_MAX_BYTES);
    if (before.lifecycle_status !== 'accepted' && !uploaded) {
      throw new StateConflictError('The receipt upload has not finished yet. Try again in a moment.');
    }

    return withTenantTransaction(tenantId, 'guest', (client) =>
      runIdempotentCommand(
        client,
        { tenantId, principalKey: `guest-reservation:${reservationId}`, operation: 'reservation.guest.receipt', intentKey: meta.idempotencyKey, requestId: meta.requestId },
        { reservation_id: reservationId, file_id: fileId },
        async () => {
          await this.requireScope(client, tenantId, reservationId, bearer, 'submit_evidence');
          const file = await readReceiptFile(client, tenantId, fileId, true);
          if (!file) throw new ValidationError('Upload the receipt again before submitting.');
          if (file.lifecycle_status !== 'accepted') {
            const problem = uploaded ? validateUploadedObject(file, uploaded) : 'The receipt upload could not be verified.';
            if (problem) {
              await rejectFileObject(client, tenantId, fileId);
              throw new ValidationError(problem);
            }
            if (!(await acceptFileObject(client, { tenantId, fileId, versionId: uploaded?.versionId ?? null }))) {
              throw new StateConflictError('The receipt changed while it was being checked. Upload it again.');
            }
          }

          const guest = await readGuestReservation(client, tenantId, reservationId);
          if (!guest) throw new NotFoundError(GUEST_NOT_FOUND);
          const locked = await lockReservationForReview(client, { tenantId, branchId: guest.branch_id, reservationId });
          if (!locked) throw new NotFoundError(GUEST_NOT_FOUND);
          if (locked.status !== 'held') throw new StateConflictError('A receipt was already sent for this request.');
          if (!locked.hold_expires_at || locked.hold_expires_at.getTime() <= locked.database_now.getTime()) {
            throw new HoldExpiredError('Your 15-minute hold ended before the receipt arrived. Please book again.');
          }
          const payment = await lockReservationPaymentForReview(client, { tenantId, reservationId });
          if (!payment || payment.rail === 'cash') throw new StateConflictError('This booking does not take an online receipt.');
          const receipt = await attachAcceptedReservationReceipt(client, { tenantId, paymentId: payment.payment_id, fileId });
          if (!receipt) throw new StateConflictError('The receipt could not be attached. Upload it again.');
          await markReceiptUnderReview(client, { tenantId, receiptId: receipt.receipt_id });
          const newVersion = await submitReservationForReview(client, { tenantId, branchId: guest.branch_id, reservationId, version: locked.version });
          if (newVersion === null) throw new StateConflictError('This request changed while the receipt was being sent.');

          await appendGuestAudit(client, {
            tenantId,
            actorKey: `guest-reservation:${reservationId}`,
            action: 'reservation.submitted_for_confirmation',
            entityType: 'reservation',
            entityId: reservationId,
            summary: { version: newVersion, receipt_id: receipt.receipt_id },
            requestId: meta.requestId,
          });
          await appendReservationOutboxEvent(client, {
            tenantId,
            dedupeKey: `reservation-pending-confirmation:${reservationId}:${newVersion}`,
            eventType: 'reservation.pending_confirmation',
            payload: { reservationId, reservationVersion: newVersion },
          });
          await emailNotifications.reservationEvent(client, tenantId, reservationId, 'request_received');
          return this.view(client, tenantId, reservationId);
        },
      ),
    );
  }

  /** Verified guest asks for a fitting. It is created `pending` for staff to confirm. */
  async requestFitting(slug: string, meta: GuestRequestMeta, request: GuestFittingRequest): Promise<CommandResult<GuestFittingCreated>> {
    const store = await this.requireStore(slug);
    return withTenantTransaction(store.tenantId, guestActorKey(request.email), (client) =>
      runIdempotentCommand(
        client,
        {
          tenantId: store.tenantId,
          principalKey: `guest:${digestRecipientEmail(request.email)}`,
          operation: 'fitting.guest.create',
          intentKey: meta.idempotencyKey,
          requestId: meta.requestId,
        },
        { ...request, verification_token: tokenHash(request.verification_token) },
        async () => {
          await this.verification.consume(client, store.tenantId, request.email, request.verification_token);
          const core = await readStoreCore(client, store);
          const document = core ? toDocument(core) : null;
          if (!document?.checkout.fitting_requests) throw new NotFoundError('This shop is not taking fitting requests online.');
          if (document.checkout.requirements.phone === 'required' && request.customer.phone === null) {
            throw new ValidationError('A mobile number is required by this shop.');
          }

          const settings = await lockFittingCreateSettings(client, { tenantId: store.tenantId, branchId: store.branchId });
          if (!settings?.enabled) throw new NotFoundError('This shop is not taking fitting requests online.');
          const startsAt = new Date(request.start_at);
          // V1 branches use whole-hour UTC offsets (Asia/Manila), so the UTC half-hour grid is the local one.
          if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0 || startsAt.getUTCMinutes() % 30 !== 0) {
            throw new ValidationError('Fitting times start on the hour or half hour.');
          }
          const endsAt = new Date(startsAt.getTime() + settings.duration_minutes * 60_000);
          const schedule = await validateFittingScheduleForCreate(client, {
            tenantId: store.tenantId,
            branchId: store.branchId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          });
          if (!schedule.is_future || !schedule.within_weekly_hours || !schedule.closure_free) {
            throw new ScheduleConflictError('That time is no longer open. Choose another time.');
          }
          for (const variantId of request.variant_ids) {
            if (!(await isVisibleVariant(client, store.tenantId, variantId))) {
              throw new ValidationError('One of the pieces you chose is no longer available.');
            }
          }

          try {
            const customer = await findOrCreateGuestCustomer(client, store.tenantId, request.email, request.customer);
            const fittingId = randomUUID();
            const feeMinor = Number(settings.fee_minor);
            await ensureFittingCapacitySlots(client, { tenantId: store.tenantId, branchId: store.branchId, capacity: settings.capacity });
            await createFittingAppointmentBase(client, {
              fittingId,
              tenantId: store.tenantId,
              branchId: store.branchId,
              customerId: customer.id,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              timezoneSnapshot: settings.timezone,
              currency: settings.currency,
              feeMinor,
              internalNote: request.note ? `Customer note: ${request.note}` : null,
              businessKey: `storefront:${digestRecipientEmail(request.email).slice(0, 32)}:${meta.idempotencyKey}`,
              bookingChannel: 'storefront',
              garments: request.variant_ids.map((variantId) => ({ lineId: randomUUID(), variantId, guaranteed: false, assetId: null })),
              chargeId: randomUUID(),
            });
            const slot = await claimFittingCapacitySlot(client, {
              allocationId: randomUUID(),
              tenantId: store.tenantId,
              branchId: store.branchId,
              fittingId,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
            });
            if (!slot) throw new CapacityConflictError('That time was just taken. Choose another time.');
            await appendGuestAudit(client, {
              tenantId: store.tenantId,
              actorKey: guestActorKey(request.email),
              action: 'fitting.created',
              entityType: 'fitting',
              entityId: fittingId,
              summary: { status: 'pending', channel: 'storefront', lines: request.variant_ids.length },
              requestId: meta.requestId,
            });
            await emailNotifications.fittingRequested(client, {
              tenantId: store.tenantId,
              fittingId,
              email: request.email,
              name: request.customer.full_name,
              startAt: startsAt,
              timezone: settings.timezone,
            });
            return guestFittingCreated.parse({
              id: fittingId,
              status: 'pending',
              start_at: startsAt.toISOString(),
              end_at: endsAt.toISOString(),
              fee_minor: feeMinor > 0 ? String(feeMinor) : null,
            });
          } catch (error) {
            if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
              throw new CapacityConflictError('That time was just taken. Choose another time.');
            }
            throw error;
          }
        },
        201,
      ),
    );
  }

  private async view(client: PoolClient, tenantId: string, reservationId: string): Promise<GuestReservationView> {
    const row = await readGuestReservation(client, tenantId, reservationId);
    if (!row) throw new NotFoundError(GUEST_NOT_FOUND);
    const payable = row.status === 'held' || row.status === 'pending_confirmation';
    const qrUrl = payable && row.rail === 'manual_qr' && row.qr_file_id
      ? ((await storefrontMediaSigner.sign(client, tenantId, [row.qr_file_id])).get(row.qr_file_id) ?? null)
      : null;
    const money = (key: string): string => {
      const value = row.price_snapshot[key];
      return typeof value === 'string' && /^\d+$/.test(value) ? value : '0';
    };
    return guestReservationView.parse({
      id: row.id,
      reference_code: row.reference_code,
      status: row.status,
      item_name: row.item_name ?? 'Rental',
      size_label: row.size_label,
      fulfillment_method: row.delivery_snapshot['fulfillment_method'] === 'delivery' ? 'delivery' : 'pickup',
      pickup_at: row.pickup_at.toISOString(),
      due_at: row.due_at.toISOString(),
      hold_expires_at: row.status === 'held' ? (row.hold_expires_at?.toISOString() ?? null) : null,
      receipt_submitted: row.receipt_submitted,
      money: {
        rental_total_minor: money('rental_total_minor'),
        security_required_minor: money('security_required_minor'),
        delivery_total_minor: money('delivery_total_minor'),
        due_now_minor: money('due_now_minor'),
      },
      payment_instructions: payable && row.rail !== 'cash'
        ? {
            method_name: row.method_name,
            rail: row.rail,
            ...(qrUrl ? { qr_image_url: qrUrl } : {}),
            ...(paymentNote(row.destination_snapshot) ? { destination_note: paymentNote(row.destination_snapshot) } : {}),
          }
        : null,
    });
  }

  private async requireStore(slug: string): Promise<PublishedStore> {
    const store = await resolvePublishedStore(slug);
    if (!store) throw new NotFoundError(STORE_NOT_FOUND);
    return store;
  }

  /** Guest routes carry no tenant; a narrow definer function maps a live token to its tenant. */
  private async resolveGuestTenant(reservationId: string, bearer: string): Promise<string> {
    const result = await pool.query<{ tenant_id: string | null }>('SELECT resolve_guest_access_tenant($1, $2) AS tenant_id', [tokenHash(bearer), reservationId]);
    const tenantId = result.rows[0]?.tenant_id;
    if (!tenantId) throw new NotFoundError(GUEST_NOT_FOUND);
    return tenantId;
  }

  private async requireScope(client: PoolClient, tenantId: string, reservationId: string, bearer: string, scope: 'view_status' | 'submit_evidence'): Promise<void> {
    const scopes = await readGuestTokenScopes(client, tenantId, reservationId, tokenHash(bearer));
    if (!scopes?.includes(scope)) throw new NotFoundError(GUEST_NOT_FOUND);
  }
}

function assertAwaitingReceipt(reservation: GuestReservationRow): void {
  if (reservation.status !== 'held') throw new StateConflictError('This request is no longer waiting for a receipt.');
  if (!reservation.hold_expires_at || reservation.hold_expires_at.getTime() <= Date.now()) {
    throw new HoldExpiredError('Your 15-minute hold ended. Please book again.');
  }
}

function receiptStorageKey(tenantId: string, reservationId: string, fileId: string): string {
  return `tenant-files/${tenantId}/guest-receipts/${reservationId}/${fileId}`;
}

function paymentNote(destination: Record<string, unknown>): string | undefined {
  const text = (key: string): string | null => {
    const value = destination[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const lines = [
    text('account_name') ? `Account name: ${text('account_name')}` : null,
    text('account_number') ? `Account number: ${text('account_number')}` : null,
    text('instructions'),
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join('\n').slice(0, 2_000) : undefined;
}

export const guestBookingService = new GuestBookingService();
