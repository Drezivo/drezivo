/**
 * TRD §4 — "Errors use a stable envelope: code, safe message, request_id,
 * optional field errors." This locks the shape so a later change to
 * errors.ts that silently drops/renames a field is caught here instead of
 * discovered by three different consumers' error-handling code breaking at
 * once.
 */
import { describe, expect, it } from 'vitest';

import { errorEnvelope } from '../src/common/errors';
import { successEnvelope } from '../src/common/envelope';
import { moneyAmount } from '../src/common/money';

describe('errorEnvelope', () => {
  it('accepts the minimal required shape: code, message, request_id', () => {
    const result = errorEnvelope.safeParse({
      code: 'VALIDATION_FAILED',
      message: 'The requested interval is invalid.',
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('accepts optional field-level errors on VALIDATION_FAILED', () => {
    const result = errorEnvelope.safeParse({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed.',
      request_id: 'req_01HXYZ',
      fields: [{ path: 'requested_interval.start', message: 'must be in the future' }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a response missing request_id — support correlation would be impossible', () => {
    const result = errorEnvelope.safeParse({
      code: 'NOT_FOUND',
      message: 'Not found.',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized error code rather than passing it through', () => {
    const result = errorEnvelope.safeParse({
      code: 'SOMETHING_NEW_THE_CLIENT_HAS_NEVER_SEEN',
      message: 'Not found.',
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a message-less envelope — "safe message" is not optional', () => {
    const result = errorEnvelope.safeParse({
      code: 'INTERNAL_ERROR',
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });
});

describe('successEnvelope', () => {
  it('wraps an arbitrary payload schema under data, alongside request_id', () => {
    const envelope = successEnvelope(moneyAmount);

    const result = envelope.safeParse({
      data: { amount_minor: '49900', currency: 'PHP' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a success response missing request_id, matching the error envelope contract', () => {
    const envelope = successEnvelope(moneyAmount);

    const result = envelope.safeParse({
      data: { amount_minor: '49900', currency: 'PHP' },
    });

    expect(result.success).toBe(false);
  });
});
