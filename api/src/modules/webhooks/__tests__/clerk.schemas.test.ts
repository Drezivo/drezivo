import { describe, expect, it } from 'vitest';

import { normalizeClerkWebhookEvent } from '../clerk.schemas.js';

describe('Clerk webhook normalization', () => {
  it('maps the supported provider families to the closed contract names', () => {
    const cases = [
      ['organization.created', 'organization.created', { id: 'org_1' }],
      ['organization.updated', 'organization.updated', { id: 'org_1' }],
      ['organization.deleted', 'organization.deleted', { id: 'org_1' }],
      [
        'organizationInvitation.accepted',
        'organization_invitation.accepted',
        { id: 'inv_1', organization_id: 'org_1' },
      ],
      [
        'organizationMembership.updated',
        'organization_membership.updated',
        { id: 'mem_1', organization: { id: 'org_1' } },
      ],
    ] as const;

    for (const [providerType, eventType, data] of cases) {
      const result = normalizeClerkWebhookEvent({ type: providerType, data });
      expect(result.kind).toBe('supported');
      if (result.kind === 'supported') {
        expect(result.event.eventType).toBe(eventType);
        expect(result.event.safePayload.organization_id).toBe('org_1');
      }
    }
  });

  it('acknowledges disallowed provider families as ignored', () => {
    expect(normalizeClerkWebhookEvent({ type: 'user.created', data: { id: 'user_1' } })).toEqual({
      kind: 'ignored',
    });
    expect(normalizeClerkWebhookEvent({ type: 'subscription.created', data: {} })).toEqual({
      kind: 'ignored',
    });
  });

  it('keeps identifiers and state while dropping provider profile fields and invalid markers', () => {
    const result = normalizeClerkWebhookEvent({
      type: 'organization.created',
      data: {
        id: 'org_1',
        name: 'Private studio name',
        image_url: 'https://example.invalid/image',
        private_metadata: {
          drezivo_onboarding: {
            source: 'wrong_source',
            account_id: 'not-a-uuid',
            attempt_id: 'not-a-uuid',
          },
          email: 'owner@example.com',
        },
      },
    });
    expect(result).toEqual({
      kind: 'supported',
      event: {
        eventType: 'organization.created',
        safePayload: { organization_id: 'org_1' },
      },
    });
  });
});
