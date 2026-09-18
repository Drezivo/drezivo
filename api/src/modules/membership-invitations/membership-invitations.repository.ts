import type { PoolClient } from 'pg';

export interface InvitationRow {
  id: string;
  tenant_id: string;
  recipient_email_digest: string;
  recipient_email_ciphertext: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: Date;
  clerk_invitation_id: string | null;
  business_key: string;
  dispatch_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface SafeInvitationRow {
  id: string;
  status: InvitationRow['status'];
  expires_at: Date;
  created_at: Date;
}

export interface InvitationDispatchSnapshot {
  invitation: InvitationRow;
  clerk_org_id: string;
}

interface InvitationDispatchQueryRow extends InvitationRow {
  clerk_org_id: string;
}

export async function lockInvitationTenant(client: PoolClient, tenantId: string): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM tenant WHERE id = $1 FOR UPDATE',
    [tenantId],
  );
  return result.rows.length === 1;
}

export async function assertOwnerMembership(
  client: PoolClient,
  input: { tenantId: string; membershipId: string; principalId: string },
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM membership
      WHERE id = $1 AND tenant_id = $2 AND clerk_user_id = $3
        AND role = 'owner' AND status = 'active'
      LIMIT 1`,
    [input.membershipId, input.tenantId, input.principalId],
  );
  return result.rows.length === 1;
}

export async function assertTenantInvitationWritesAllowed(
  client: PoolClient,
  tenantId: string,
): Promise<boolean> {
  const result = await client.query<{ tenant_status: string; subscription_status: string }>(
    `SELECT t.status AS tenant_status, s.status AS subscription_status
       FROM tenant t
       JOIN subscription s ON s.tenant_id = t.id
      WHERE t.id = $1
      LIMIT 1`,
    [tenantId],
  );
  const row = result.rows[0];
  return (
    row?.tenant_status === 'active' &&
    !['restricted', 'cancelled'].includes(row.subscription_status)
  );
}

export async function expirePendingInvitations(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query(
    `UPDATE membership_invitation
        SET status = 'expired', updated_at = now()
      WHERE tenant_id = $1 AND status = 'pending' AND expires_at <= now()`,
    [tenantId],
  );
}

export async function findPendingInvitationByDigest(
  client: PoolClient,
  tenantId: string,
  digest: string,
): Promise<InvitationRow | null> {
  const result = await client.query<InvitationRow>(
    `SELECT id, tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
            expires_at, clerk_invitation_id, business_key, dispatch_version, created_at, updated_at
       FROM membership_invitation
      WHERE tenant_id = $1 AND recipient_email_digest = $2 AND status = 'pending'
      FOR UPDATE`,
    [tenantId, digest],
  );
  return result.rows[0] ?? null;
}

export async function insertInvitation(
  client: PoolClient,
  input: {
    tenantId: string;
    digest: string;
    ciphertext: string;
    businessKey: string;
  },
): Promise<InvitationRow> {
  const result = await client.query<InvitationRow>(
    `INSERT INTO membership_invitation
       (tenant_id, recipient_email_digest, recipient_email_ciphertext, business_key, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '7 days')
     RETURNING id, tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
               expires_at, clerk_invitation_id, business_key, dispatch_version, created_at, updated_at`,
    [input.tenantId, input.digest, input.ciphertext, input.businessKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Invitation insert returned no row.');
  return row;
}

export async function lockInvitation(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const result = await client.query<InvitationRow>(
    `SELECT id, tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
            expires_at, clerk_invitation_id, business_key, dispatch_version, created_at, updated_at
       FROM membership_invitation
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tenantId, invitationId],
  );
  return result.rows[0] ?? null;
}

/** Worker-only snapshot: lock both the invitation and its tenant before calling Clerk. */
export async function lockInvitationForDispatch(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<InvitationDispatchSnapshot | null> {
  const result = await client.query<InvitationDispatchQueryRow>(
    `SELECT i.id, i.tenant_id, i.recipient_email_digest, i.recipient_email_ciphertext, i.status,
            i.expires_at, i.clerk_invitation_id, i.business_key, i.dispatch_version,
            i.created_at, i.updated_at, t.clerk_org_id
       FROM membership_invitation i
       JOIN tenant t ON t.id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.id = $2
      FOR UPDATE OF i, t`,
    [tenantId, invitationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const { clerk_org_id, ...invitation } = row;
  return { invitation, clerk_org_id };
}

/** Persist provider correlation only while the exact local dispatch is still current. */
export async function updateInvitationProviderCorrelation(
  client: PoolClient,
  input: {
    tenantId: string;
    invitationId: string;
    dispatchVersion: number;
    providerInvitationId: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE membership_invitation
        SET clerk_invitation_id = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'pending' AND dispatch_version = $3
      RETURNING id`,
    [input.tenantId, input.invitationId, input.dispatchVersion, input.providerInvitationId],
  );
  return result.rows.length === 1;
}

export async function updateInvitationForResend(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const result = await client.query<InvitationRow>(
    `UPDATE membership_invitation
        SET status = 'pending', expires_at = now() + interval '7 days',
            dispatch_version = dispatch_version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'expired', 'revoked')
      RETURNING id, tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
                expires_at, clerk_invitation_id, business_key, dispatch_version, created_at, updated_at`,
    [tenantId, invitationId],
  );
  return result.rows[0] ?? null;
}

export async function revokeInvitation(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const result = await client.query<InvitationRow>(
    `UPDATE membership_invitation
        SET status = CASE WHEN status = 'pending' THEN 'revoked' ELSE status END,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
                expires_at, clerk_invitation_id, business_key, dispatch_version, created_at, updated_at`,
    [tenantId, invitationId],
  );
  return result.rows[0] ?? null;
}

export async function insertInvitationOutbox(
  client: PoolClient,
  input: { tenantId: string; invitationId: string; dispatchVersion: number; operation: string },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, 'clerk.invitation.dispatch_requested', $3::jsonb)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      input.tenantId,
      `membership-invitation:${input.invitationId}:${input.dispatchVersion}:${input.operation}`,
      JSON.stringify({
        invitation_id: input.invitationId,
        dispatch_version: input.dispatchVersion,
        operation: input.operation,
      }),
    ],
  );
}

export async function insertInvitationRevokeOutbox(
  client: PoolClient,
  input: { tenantId: string; invitationId: string; dispatchVersion: number },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, 'clerk.invitation.revoke_requested', $3::jsonb)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      input.tenantId,
      `membership-invitation:${input.invitationId}:${input.dispatchVersion}:revoke`,
      JSON.stringify({
        invitation_id: input.invitationId,
        dispatch_version: input.dispatchVersion,
        operation: 'cancel',
      }),
    ],
  );
}

export async function listSafeInvitations(
  client: PoolClient,
  input: { tenantId: string; cursorCreatedAt?: Date; cursorId?: string; limit: number },
): Promise<SafeInvitationRow[]> {
  const result = await client.query<SafeInvitationRow>(
    `SELECT id, status, expires_at, created_at
       FROM membership_invitation
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [input.tenantId, input.cursorCreatedAt ?? null, input.cursorId ?? null, input.limit + 1],
  );
  return result.rows;
}

export function toSafeInvitation(row: InvitationRow | SafeInvitationRow): SafeInvitationRow {
  return {
    id: row.id,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}
