/**
 * TRD §4 — every endpoint's response uses one stable envelope, discriminated
 * on `success`. This locks the shape so a later change to envelope.ts or
 * errors.ts that silently drops/renames a field is caught here instead of
 * discovered by three different consumers' parsing code breaking at once.
 */
import { describe, expect, it } from 'vitest';

import { errorEnvelope, errorCode } from '../src/common/errors';
import { apiEnvelope, successEnvelope } from '../src/common/envelope';
import { moneyAmount } from '../src/common/money';

describe('errorEnvelope', () => {
  it('accepts the minimal required shape: success false, error object, request_id', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'The requested interval is invalid.' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('accepts optional field-level errors nested under error', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed.',
        fields: [{ field: 'requested_interval.start', message: 'must be in the future' }],
      },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('accepts NOT_IMPLEMENTED — the code for contract routes this api build has not shipped', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Not available in this scaffold.' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a response missing request_id — support correlation would be impossible', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found.' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an envelope whose error details are missing entirely', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized error code rather than passing it through', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'SOMETHING_NEW_THE_CLIENT_HAS_NEVER_SEEN', message: 'Not found.' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a message-less error object — "safe message" is not optional', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });

  it('keeps errorCode a closed enum — a success discriminator on the failure envelope fails', () => {
    expect(errorCode.options).toContain('NOT_IMPLEMENTED');

    const result = errorEnvelope.safeParse({
      success: true,
      error: { code: 'NOT_FOUND', message: 'Not found.' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });
});

describe('successEnvelope', () => {
  it('wraps an arbitrary payload schema under data, with success true and request_id', () => {
    const envelope = successEnvelope(moneyAmount);

    const result = envelope.safeParse({
      success: true,
      data: { amount_minor: '49900', currency: 'PHP' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('accepts data: null for no-content mutations, keeping the envelope uniform', () => {
    const envelope = successEnvelope(moneyAmount.nullable());

    const result = envelope.safeParse({
      success: true,
      data: null,
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a success response missing request_id, matching the failure envelope contract', () => {
    const envelope = successEnvelope(moneyAmount);

    const result = envelope.safeParse({
      success: true,
      data: { amount_minor: '49900', currency: 'PHP' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a payload that violates the data schema', () => {
    const envelope = successEnvelope(moneyAmount);

    const result = envelope.safeParse({
      success: true,
      data: { amount_minor: 'four hundred', currency: 'PHP' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });
});

describe('apiEnvelope', () => {
  it('parses a valid success response and yields the typed data', () => {
    const envelope = apiEnvelope(moneyAmount);

    const result = envelope.safeParse({
      success: true,
      data: { amount_minor: '49900', currency: 'PHP' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('parses a valid failure response through the same union', () => {
    const envelope = apiEnvelope(moneyAmount);

    const result = envelope.safeParse({
      success: false,
      error: { code: 'CAPACITY_CONFLICT', message: 'Someone else took that garment.' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(true);
    if (result.success && !result.data.success) {
      expect(result.data.error.code).toBe('CAPACITY_CONFLICT');
    }
  });

  it('rejects a response with no discriminator value', () => {
    const envelope = apiEnvelope(moneyAmount);

    const result = envelope.safeParse({
      data: { amount_minor: '49900', currency: 'PHP' },
      request_id: 'req_01HXYZ',
    });

    expect(result.success).toBe(false);
  });
});
