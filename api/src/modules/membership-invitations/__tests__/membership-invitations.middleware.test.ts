import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { validateMembershipInvitationPagination } from '../membership-invitations.middleware.js';

describe('validateMembershipInvitationPagination', () => {
  it('stores validated pagination without assigning to Express 5’s getter-only query property', () => {
    const req = Object.defineProperty({}, 'query', {
      configurable: true,
      get: () => ({ limit: '50' }),
    }) as Request;
    const next = vi.fn();

    validateMembershipInvitationPagination(req, {} as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.membershipInvitationPagination).toEqual({ limit: 50 });
  });

  it('rejects invalid pagination without setting validated values', () => {
    const req = Object.defineProperty({}, 'query', {
      configurable: true,
      get: () => ({ limit: 'not-a-number' }),
    }) as Request;
    const next = vi.fn();

    validateMembershipInvitationPagination(req, {} as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Pagination is invalid.',
    });
    expect(req.membershipInvitationPagination).toBeUndefined();
  });
});
