import type { PoolClient } from 'pg';

import type { NotificationPreferences } from '@drezivo/contracts';

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
  businessEmail: string | null;
  preferences: NotificationPreferences;
}

export class EmailNotifications {
  async reservationRequestReceived(client: PoolClient, tenantId: string, reservationId: string): Promise<void> {
    const workspace = await this.workspace(client, tenantId);
    if (!workspace?.preferences.email_enabled || !workspace.businessEmail || !workspace.preferences.business.new_request) return;
    const reservation = await client.query<{
      reference_code: string;
      pickup_at: Date;
      due_at: Date;
      timezone_snapshot: string;
      item_names: string | null;
      fulfillment_method: string | null;
      delivery_terms: string | null;
    }>(
      `SELECT r.reference_code, r.pickup_at, r.due_at, r.timezone_snapshot,
              (SELECT string_agg(rl.name_snapshot, ', ' ORDER BY rl.line_number) FROM reservation_line rl
                WHERE rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id) AS item_names,
              r.delivery_snapshot ->> 'fulfillment_method' AS fulfillment_method,
              r.delivery_snapshot ->> 'terms' AS delivery_terms
         FROM reservation r
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [tenantId, reservationId],
    );
    const row = reservation.rows[0];
    if (!row) return;
    const when = `${formatLocal(row.pickup_at, row.timezone_snapshot)} to ${formatLocal(row.due_at, row.timezone_snapshot)}`;
    const delivery = row.fulfillment_method === 'delivery';
    const summary = [
      `Item: ${row.item_names ?? 'Rental'}`,
      `Dates: ${when}`,
      `Handover: ${delivery ? 'Delivery' : 'Pickup at the shop'}`,
      `Reference: ${row.reference_code}`,
    ];
    // Renter contact details stay in the app; the email only says that delivery needs arranging.
    const deliveryNote = !delivery
      ? []
      : row.delivery_terms === 'to_arrange'
        ? ['The renter asked for delivery. Contact them from the reservation in Drezivo to arrange it and any delivery fee.', '']
        : ['The renter chose delivery. Their delivery address is on the reservation in Drezivo.', ''];
    await enqueueEmail(client, tenantId, `reservation-email:${reservationId}:new_request:business`, {
      to: workspace.businessEmail,
      subject: `New rental request ${row.reference_code}${delivery ? ' · Delivery requested' : ''}`,
      text: ['A customer sent a rental request with a payment receipt. Review it in Reservations.', '', ...deliveryNote, ...summary].join('\n'),
    });
  }

  async fittingRequested(client: PoolClient, input: { tenantId: string; fittingId: string; startAt: Date; timezone: string }): Promise<void> {
    const workspace = await this.workspace(client, input.tenantId);
    if (!workspace?.preferences.email_enabled || !workspace.businessEmail || !workspace.preferences.business.new_fitting_request) return;
    const when = formatLocal(input.startAt, input.timezone);
    await enqueueEmail(client, input.tenantId, `fitting-email:${input.fittingId}:business`, {
      to: workspace.businessEmail,
      subject: `New fitting request for ${when}`,
      text: 'A customer requested a fitting from your storefront. Review it in Fittings.',
    });
  }

  private async workspace(client: PoolClient, tenantId: string): Promise<WorkspaceMailContext | null> {
    const result = await client.query<{ business_email: string | null; notification_preferences: Record<string, unknown> | null }>(
      `SELECT ts.business_email, ts.notification_preferences
         FROM tenant t
         LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      businessEmail: row.business_email,
      // The owner notification toggles remain active. Customer message preferences are dormant.
      preferences: NOTIFICATION_PREFERENCES_ENFORCED ? preferencesOf(row.notification_preferences ?? {}) : allOn(preferencesOf({})),
    };
  }
}

function formatLocal(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(instant);
}

/**
 * Owner email toggles (Settings → Notifications) are hidden during the pilot, so saved toggles are
 * ignored while this is false. Set it back
 * to true together with app/src/lib/features.ts SHOW_NOTIFICATION_SETTINGS.
 */
export const NOTIFICATION_PREFERENCES_ENFORCED = false;

function allOn<T>(preferences: T): T {
  const flip = (value: unknown): unknown =>
    typeof value === 'boolean' ? true : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, flip(inner)])) : value;
  return flip(preferences) as T;
}

export const emailNotifications = new EmailNotifications();
