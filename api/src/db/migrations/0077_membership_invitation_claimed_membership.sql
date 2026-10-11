-- Preserve the local membership that accepted each invitation. This makes a removed member's
-- accepted invitation distinguishable from an active/suspended member when the Owner re-invites.

ALTER TABLE membership
  ADD CONSTRAINT membership_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE membership_invitation
  ADD COLUMN claimed_membership_id uuid;

-- Claim audit events are the authoritative historical link. Process in bounded batches and leave
-- ambiguous or unlinked accepted rows NULL so application code will fail closed for them.
DO $$
DECLARE
  rows_updated integer;
BEGIN
  LOOP
    WITH claim_links AS (
      SELECT event.tenant_id,
             event.redacted_summary ->> 'invitation_id' AS invitation_id,
             min(event.entity_id::text)::uuid AS membership_id
        FROM audit_event event
       WHERE event.action = 'membership_invitation.claimed'
         AND event.entity_type = 'membership'
         AND event.outcome = 'succeeded'
         AND event.entity_id IS NOT NULL
         AND event.redacted_summary ->> 'membership_id' = event.entity_id::text
       GROUP BY event.tenant_id, event.redacted_summary ->> 'invitation_id'
      HAVING count(DISTINCT event.entity_id) = 1
    ), batch AS (
      SELECT invitation.id, link.membership_id
        FROM membership_invitation invitation
        JOIN claim_links link
          ON link.tenant_id = invitation.tenant_id
         AND link.invitation_id = invitation.id::text
       WHERE invitation.status = 'accepted'
         AND invitation.claimed_membership_id IS NULL
       ORDER BY invitation.created_at, invitation.id
       LIMIT 1000
       FOR UPDATE OF invitation SKIP LOCKED
    )
    UPDATE membership_invitation invitation
       SET claimed_membership_id = batch.membership_id
      FROM batch
     WHERE invitation.id = batch.id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END $$;

ALTER TABLE membership_invitation
  ADD CONSTRAINT membership_invitation_claimed_membership_tenant_fk
  FOREIGN KEY (tenant_id, claimed_membership_id)
  REFERENCES membership (tenant_id, id)
  ON DELETE RESTRICT;

CREATE INDEX membership_invitation_claimed_membership_idx
  ON membership_invitation (tenant_id, claimed_membership_id)
  WHERE claimed_membership_id IS NOT NULL;

CREATE INDEX membership_invitation_recipient_status_idx
  ON membership_invitation (tenant_id, recipient_email_digest, status);

CREATE INDEX outbox_event_pending_member_removal_idx
  ON outbox_event (tenant_id, (payload ->> 'membership_id'))
  WHERE event_type = 'clerk.membership.remove_requested'
    AND status IN ('pending', 'leased');
