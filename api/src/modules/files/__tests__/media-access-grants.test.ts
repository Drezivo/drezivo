import { describe, expect, it } from 'vitest';

import {
  FILE_MEDIA_GRANT_TTL_SECONDS,
  issueFileMediaGrant,
  issuePreviewMediaSession,
  verifyFileMediaGrant,
  verifyPreviewMediaSession,
} from '../media-access-grants.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const storeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reservationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const fileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('browser media grants', () => {
  it('limits a preview session to the original preview expiry', () => {
    const now = new Date('2026-10-30T00:00:00.000Z');
    const session = issuePreviewMediaSession({ tenantId, storefrontId: storeId, expiresAt: now.getTime() / 1000 + 90 }, now);
    expect(Date.parse(session.expiresAt)).toBe(now.getTime() + 90_000);
    expect(verifyPreviewMediaSession(session.session, new Date(now.getTime() + 89_000))).toMatchObject({ tenantId, storefrontId: storeId });
    expect(verifyPreviewMediaSession(session.session, new Date(now.getTime() + 90_000))).toBeNull();
  });

  it('does not let a file grant outlive its preview session', () => {
    const now = new Date('2026-10-30T00:00:00.000Z');
    const sessionExpiresAt = now.getTime() / 1000 + 45;
    const issued = issueFileMediaGrant(
      { purpose: 'preview', tenantId, resourceId: storeId, fileId },
      now,
      sessionExpiresAt,
    );
    expect(Date.parse(issued.expiresAt)).toBe(sessionExpiresAt * 1000);
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'preview', resourceId: storeId, fileId }, new Date(sessionExpiresAt * 1000))).toBeNull();
  });

  it('scopes a file grant to its audience, reservation/store, and file, and expires in five minutes', () => {
    const now = new Date('2026-10-30T00:00:00.000Z');
    const issued = issueFileMediaGrant({ purpose: 'guest', tenantId, resourceId: reservationId, fileId }, now);
    expect(Date.parse(issued.expiresAt)).toBe(now.getTime() + FILE_MEDIA_GRANT_TTL_SECONDS * 1000);
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'guest', resourceId: reservationId, fileId }, now)).toMatchObject({
      tenantId,
      resourceId: reservationId,
      fileId,
      purpose: 'guest',
    });
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'preview', fileId }, now)).toBeNull();
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'guest', resourceId: storeId, fileId }, now)).toBeNull();
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'guest', resourceId: reservationId, fileId: storeId }, now)).toBeNull();
    expect(verifyFileMediaGrant(issued.grant, { purpose: 'guest', resourceId: reservationId, fileId }, new Date(now.getTime() + 5 * 60_000))).toBeNull();
  });
});
