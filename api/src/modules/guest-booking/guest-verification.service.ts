import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { ConfirmGuestVerificationResponse, StartGuestVerificationResponse } from '@drezivo/contracts';

import { config } from '../../config/index.js';
import { emailEnabled } from '../../integrations/email/email-sender.js';
import { BookingPausedError, DependencyUnavailableError, ForbiddenError, NotFoundError, UnauthenticatedError } from '../../shared/errors.js';
import { turnstileVerifier, type TurnstileVerifier } from '../../integrations/turnstile/turnstile.js';
import { digestRecipientEmail, keyedDigest } from '../../shared/protected-recipient.js';
import { emailNotifications, type EmailNotifications } from '../notifications/email-notifications.js';
import { toDocument } from '../storefront-cms/storefront-cms.service.js';
import { readStoreCore, withPublishedStore } from '../storefront/storefront.repository.js';

const CODE_TTL_SECONDS = 10 * 60;
const TOKEN_TTL_MINUTES = 30;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const INVALID_CODE = 'That code is not valid or has expired. Request a new one.';
const STORE_NOT_FOUND = 'This store is not available.';

const codeDigest = (verificationId: string, code: string): Buffer => keyedDigest('guest-verification-code', `${verificationId}:${code}`);
export const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Proves a guest controls an email address before any booking is written.
 *
 * - Codes are 6 random digits, stored only as a keyed digest, valid 10 minutes, 5 attempts each.
 * - At most 5 codes per address per hour per store; extra requests get the same answer and send
 *   nothing, so the endpoint cannot be used to flood an inbox or to learn anything.
 * - A correct code yields a 30-minute token (stored as a SHA-256 hash) that a booking consumes.
 */
const BOOKING_PAUSED = 'Online booking is paused for this shop right now. Please contact the shop directly.';

export class GuestVerificationService {
  constructor(
    private readonly notifications: EmailNotifications = emailNotifications,
    private readonly isEmailEnabled: () => boolean = emailEnabled,
    // Development only (config refuses it in production): no email is sent and any code passes.
    private readonly acceptAnyCode: () => boolean = () => config.GUEST_VERIFICATION_MODE === 'dev_accept_any',
    private readonly robotCheck: TurnstileVerifier = turnstileVerifier,
  ) {}

  async start(slug: string, email: string, robot: { token?: string | undefined; remoteIp?: string | undefined } = {}): Promise<StartGuestVerificationResponse> {
    // Checked before anything else so bots cannot use a storefront to send email (fails closed).
    if ((await this.robotCheck.verify(robot.token, robot.remoteIp)) === 'failed') {
      throw new ForbiddenError('Please complete the "I am human" check and try again.');
    }
    const acceptAnyCode = this.acceptAnyCode();
    const done = await withPublishedStore(slug, async (client, store) => {
      // A paused shop is the answer that matters to the renter, whatever the email provider's state.
      if (!store.bookingOpen) throw new BookingPausedError(BOOKING_PAUSED);
      if (!acceptAnyCode && !this.isEmailEnabled()) {
        throw new DependencyUnavailableError('Email verification is unavailable right now. Please contact the shop directly.');
      }
      const digest = digestRecipientEmail(email);
      const recent = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM guest_email_verification
          WHERE tenant_id = $1 AND email_digest = $2 AND created_at > statement_timestamp() - interval '1 hour'`,
        [store.tenantId, digest],
      );
      if ((recent.rows[0]?.n ?? 0) >= MAX_CODES_PER_HOUR) return true;

      const id = randomUUID();
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await client.query(
        `INSERT INTO guest_email_verification (id, tenant_id, email_digest, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, statement_timestamp() + make_interval(secs => $5))`,
        [id, store.tenantId, digest, codeDigest(id, code).toString('hex'), CODE_TTL_SECONDS],
      );
      if (acceptAnyCode) return true;
      const core = await readStoreCore(client, store);
      const storeName = core ? toDocument(core).branding.display_name : 'the shop';
      await this.notifications.verificationCode(client, { tenantId: store.tenantId, verificationId: id, storeName, email, code });
      return true;
    });
    if (!done) throw new NotFoundError(STORE_NOT_FOUND);
    return { accepted: true, code_length: 6, expires_in_seconds: CODE_TTL_SECONDS };
  }

  async confirm(slug: string, email: string, code: string): Promise<ConfirmGuestVerificationResponse> {
    const outcome = await withPublishedStore(slug, async (client, store) => {
      if (!store.bookingOpen) throw new BookingPausedError(BOOKING_PAUSED);
      const row = await client.query<{ id: string; code_hash: string; attempts: number; live: boolean }>(
        `SELECT id, code_hash, attempts, expires_at > statement_timestamp() AS live
           FROM guest_email_verification
          WHERE tenant_id = $1 AND email_digest = $2 AND verified_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [store.tenantId, digestRecipientEmail(email)],
      );
      const latest = row.rows[0];
      if (!latest || !latest.live || latest.attempts >= MAX_ATTEMPTS) return { ok: false as const };

      const expected = Buffer.from(latest.code_hash, 'hex');
      const actual = codeDigest(latest.id, code);
      const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!matches && !this.acceptAnyCode()) {
        // Committed on purpose: the failed attempt must count even though the request fails.
        await client.query('UPDATE guest_email_verification SET attempts = attempts + 1 WHERE tenant_id = $1 AND id = $2', [store.tenantId, latest.id]);
        return { ok: false as const };
      }

      const token = randomBytes(32).toString('base64url');
      const verified = await client.query<{ token_expires_at: Date }>(
        `UPDATE guest_email_verification
            SET verified_at = statement_timestamp(), token_hash = $3,
                token_expires_at = statement_timestamp() + make_interval(mins => $4)
          WHERE tenant_id = $1 AND id = $2
          RETURNING token_expires_at`,
        [store.tenantId, latest.id, tokenHash(token), TOKEN_TTL_MINUTES],
      );
      return { ok: true as const, token, expiresAt: verified.rows[0]?.token_expires_at ?? new Date() };
    });
    if (outcome === null) throw new NotFoundError(STORE_NOT_FOUND);
    if (!outcome.ok) throw new UnauthenticatedError(INVALID_CODE);
    return { verification_token: outcome.token, expires_at: outcome.expiresAt.toISOString() };
  }

  /** Spends one use of a verification token inside the caller's booking transaction. */
  async consume(client: PoolClient, tenantId: string, email: string, token: string): Promise<void> {
    const used = await client.query(
      `UPDATE guest_email_verification
          SET token_uses = token_uses + 1
        WHERE tenant_id = $1 AND token_hash = $2 AND email_digest = $3
          AND token_expires_at > statement_timestamp() AND token_uses < 5`,
      [tenantId, tokenHash(token), digestRecipientEmail(email)],
    );
    if (used.rowCount !== 1) throw new UnauthenticatedError('Your email verification expired. Verify your email again to continue.');
  }
}

export const guestVerificationService = new GuestVerificationService();
