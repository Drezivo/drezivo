import { describe, expect, it } from 'vitest';

import { signProofLink, verifyProofLink } from '../operator-proof-link.js';

const secret = 'operator-proof-link-test-secret-0123456789';
const grant = { tenantId: '550e8400-e29b-41d4-a716-446655440000', paymentId: '750e8400-e29b-41d4-a716-446655440000' };
const expiresAt = new Date('2026-10-01T00:00:00.000Z');
// Same vector as Drezivo-Operator-API test/proof-link.test.ts: if either side changes the format,
// one of the two tests fails instead of every operator proof link silently returning 404.
const SHARED_VECTOR =
  'p1.550e8400-e29b-41d4-a716-446655440000.750e8400-e29b-41d4-a716-446655440000.1790812800.hoJ16R8mj0g7JAbv17giTQoJPtwVtPcCQe3QZUQCBHA';
const fourMinutesBefore = new Date(expiresAt.getTime() - 4 * 60 * 1000);

describe('operator proof links', () => {
  it('matches the vector the operator API produces', () => {
    expect(signProofLink(grant, expiresAt, secret)).toBe(SHARED_VECTOR);
    expect(verifyProofLink(SHARED_VECTOR, fourMinutesBefore, secret)).toEqual(grant);
  });

  it('rejects a tampered signature, another payment, or the wrong secret', () => {
    const flipped = SHARED_VECTOR.slice(0, -1) + (SHARED_VECTOR.endsWith('A') ? 'B' : 'A');
    expect(verifyProofLink(flipped, fourMinutesBefore, secret)).toBeNull();
    const otherPayment = SHARED_VECTOR.replace('750e8400', '750e8401');
    expect(verifyProofLink(otherPayment, fourMinutesBefore, secret)).toBeNull();
    expect(verifyProofLink(SHARED_VECTOR, fourMinutesBefore, `${secret}-other`)).toBeNull();
  });

  it('is off without a secret and refuses malformed tokens', () => {
    expect(verifyProofLink(SHARED_VECTOR, fourMinutesBefore, undefined)).toBeNull();
    expect(verifyProofLink('p1.not-a-token', fourMinutesBefore, secret)).toBeNull();
    expect(verifyProofLink(SHARED_VECTOR.toUpperCase(), fourMinutesBefore, secret)).toBeNull();
    expect(verifyProofLink(`${SHARED_VECTOR}${'x'.repeat(200)}`, fourMinutesBefore, secret)).toBeNull();
  });

  it('expires at its deadline and refuses links that live too long, allowing a minute of clock skew', () => {
    expect(verifyProofLink(SHARED_VECTOR, expiresAt, secret)).toBeNull();
    // Five minutes plus 59 seconds ahead: a fast operator clock, still accepted.
    expect(verifyProofLink(SHARED_VECTOR, new Date(expiresAt.getTime() - 359 * 1000), secret)).toEqual(grant);
    // More than six minutes ahead: longer than any link the operator API signs.
    expect(verifyProofLink(SHARED_VECTOR, new Date(expiresAt.getTime() - 361 * 1000), secret)).toBeNull();
  });
});
