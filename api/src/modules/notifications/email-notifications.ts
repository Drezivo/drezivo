import type { PoolClient } from 'pg';

import type { NotificationPreferences } from '@drezivo/contracts';

import { config } from '../../config/index.js';
import { guestTokenFor } from '../../shared/guest-token.js';
import { openProtectedText, sealProtectedText } from '../../shared/protected-recipient.js';
import { preferencesOf } from '../settings/settings.service.js';

export const EMAIL_EVENT_TYPE = 'notification.email';

interface ComposedEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Emails are composed inside the business transaction and stored sealed (AES-GCM) in the outbox.
 * The worker only decrypts and hands the message to the provider, so it needs no access to tenant
 * tables, and no address or code sits in plaintext in the database. Dedupe keys make each business
 * event produce at most one email per recipient even if the transaction is retried.
 */
async function enqueueEmail(client: PoolClient, tenantId: string, dedupeKey: string, email: ComposedEmail): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [tenantId, dedupeKey, EMAIL_EVENT_TYPE, JSON.stringify({ sealed: sealProtectedText(JSON.stringify(email)) })],
  );
}

export function openSealedEmail(payload: Record<string, unknown>): ComposedEmail {
  const sealed = payload['sealed'];
  if (typeof sealed !== 'string') throw new Error('Email outbox payload is malformed.');
  const email = JSON.parse(openProtectedText(sealed)) as Partial<ComposedEmail>;
  if (typeof email.to !== 'string' || typeof email.subject !== 'string' || typeof email.text !== 'string') {
    throw new Error('Email outbox payload is malformed.');
  }
  return { to: email.to, subject: email.subject, text: email.text };
}

interface WorkspaceMailContext {
  storeName: string;
  slug: string | null;
  businessEmail: string | null;
  preferences: NotificationPreferences;
}

type ReservationMailEvent = 'request_received' | 'request_confirmed' | 'request_rejected' | 'request_cancelled';

const RESERVATION_COPY: Record<ReservationMailEvent, { subject: string; body: string }> = {
  request_received: {
    subject: 'We received your rental request',
    body: 'Your request and payment receipt are with the shop. The size is held for you while they review it, and you will get another email once they confirm.',
  },
  request_confirmed: {
    subject: 'Your rental is confirmed',
    body: 'The shop confirmed your rental. Bring a valid ID at pickup. Contact the shop if anything changes.',
  },
  request_rejected: {
    subject: 'Your rental request was declined',
    body: 'The shop could not accept this request, so the size has been released. They will contact you about any payment you already sent.',
  },
  request_cancelled: {
    subject: 'Your rental was cancelled',
    body: 'This rental has been cancelled. The shop will contact you about any refund due under their cancellation policy.',
  },
};

export class EmailNotifications {
  /** The one-time code email. Always sent: a guest who asked for a code must receive it. */
  async verificationCode(client: PoolClient, input: { tenantId: string; verificationId: string; storeName: string; email: string; code: string }): Promise<void> {
    await enqueueEmail(client, input.tenantId, `guest-verification:${input.verificationId}`, {
      to: input.email,
      subject: `${input.code} is your ${input.storeName} verification code`,
      text: [
        `Your verification code for ${input.storeName} is ${input.code}.`,
        '',
        'It expires in 10 minutes. If you did not ask for it, you can ignore this email.',
      ].join('\n'),
    });
  }

  async reservationEvent(client: PoolClient, tenantId: string, reservationId: string, event: ReservationMailEvent): Promise<void> {
    const workspace = await this.workspace(client, tenantId);
    if (!workspace?.preferences.email_enabled) return;
    const reservation = await client.query<{
      reference_code: string;
      pickup_at: Date;
      due_at: Date;
      timezone_snapshot: string;
      customer_email: string | null;
      customer_name: string | null;
      item_name: string | null;
    }>(
      `SELECT r.reference_code, r.pickup_at, r.due_at, r.timezone_snapshot,
              r.customer_snapshot ->> 'email' AS customer_email, r.customer_snapshot ->> 'full_name' AS customer_name,
              (SELECT rl.name_snapshot FROM reservation_line rl
                WHERE rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id ORDER BY rl.line_number LIMIT 1) AS item_name
         FROM reservation r
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [tenantId, reservationId],
    );
    const row = reservation.rows[0];
    if (!row) return;
    const when = `${formatLocal(row.pickup_at, row.timezone_snapshot)} to ${formatLocal(row.due_at, row.timezone_snapshot)}`;
    const summary = [`Item: ${row.item_name ?? 'Rental'}`, `Dates: ${when}`, `Reference: ${row.reference_code}`];
    // Private link: the token sits in the URL fragment, which browsers never send to a server.
    const statusLink = config.STOREFRONT_PUBLIC_ORIGIN && workspace.slug
      ? `${config.STOREFRONT_PUBLIC_ORIGIN.replace(/\/$/, '')}/s/${workspace.slug}/booking#${reservationId}.${guestTokenFor(reservationId)}`
      : null;

    if (row.customer_email && workspace.preferences.customer[event]) {
      const copy = RESERVATION_COPY[event];
      await enqueueEmail(client, tenantId, `reservation-email:${reservationId}:${event}:customer`, {
        to: row.customer_email,
        subject: `${copy.subject} · ${workspace.storeName}`,
        text: [
          `Hi ${row.customer_name ?? 'there'},`,
          '',
          copy.body,
          '',
          ...summary,
          ...(statusLink ? ['', 'See your request any time (keep this link private):', statusLink] : []),
          '',
          `— ${workspace.storeName}`,
        ].join('\n'),
      });
    }
    if (event === 'request_received' && workspace.businessEmail && workspace.preferences.business.new_request) {
      await enqueueEmail(client, tenantId, `reservation-email:${reservationId}:new_request:business`, {
        to: workspace.businessEmail,
        subject: `New rental request ${row.reference_code}`,
        text: ['A customer sent a rental request with a payment receipt. Review it in Reservations.', '', ...summary].join('\n'),
      });
    }
  }

  async fittingRequested(client: PoolClient, input: { tenantId: string; fittingId: string; email: string; name: string; startAt: Date; timezone: string }): Promise<void> {
    const workspace = await this.workspace(client, input.tenantId);
    if (!workspace?.preferences.email_enabled) return;
    const when = formatLocal(input.startAt, input.timezone);
    if (workspace.preferences.customer.fitting_requested) {
      await enqueueEmail(client, input.tenantId, `fitting-email:${input.fittingId}:customer`, {
        to: input.email,
        subject: `Fitting request received · ${workspace.storeName}`,
        text: [`Hi ${input.name},`, '', `We received your fitting request for ${when}. The shop will confirm it by email.`, '', `— ${workspace.storeName}`].join('\n'),
      });
    }
    if (workspace.businessEmail && workspace.preferences.business.new_fitting_request) {
      await enqueueEmail(client, input.tenantId, `fitting-email:${input.fittingId}:business`, {
        to: workspace.businessEmail,
        subject: `New fitting request for ${when}`,
        text: 'A customer requested a fitting from your storefront. Review it in Fittings.',
      });
    }
  }

  private async workspace(client: PoolClient, tenantId: string): Promise<WorkspaceMailContext | null> {
    const result = await client.query<{ store_name: string | null; slug: string | null; tenant_name: string; business_email: string | null; notification_preferences: Record<string, unknown> | null }>(
      `SELECT sf.branding ->> 'display_name' AS store_name, sf.slug, t.name AS tenant_name,
              ts.business_email, ts.notification_preferences
         FROM tenant t
         LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
         LEFT JOIN LATERAL (
           SELECT branding, slug FROM storefront WHERE tenant_id = t.id ORDER BY created_at, id LIMIT 1
         ) sf ON true
        WHERE t.id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      storeName: row.store_name ?? row.tenant_name,
      slug: row.slug,
      businessEmail: row.business_email,
      preferences: preferencesOf(row.notification_preferences ?? {}),
    };
  }
}

function formatLocal(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(instant);
}

export const emailNotifications = new EmailNotifications();
