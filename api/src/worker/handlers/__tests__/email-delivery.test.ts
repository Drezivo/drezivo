import { describe, expect, it, vi } from 'vitest';

import { sealProtectedText } from '../../../shared/protected-recipient.js';
import { PermanentOutboxError, type OutboxRow } from '../../runner.js';
import { createEmailDeliveryHandler } from '../email-delivery.js';

const row = (payload: Record<string, unknown>): OutboxRow => ({
  id: 'outbox-1',
  tenant_id: 'tenant-1',
  dedupe_key: 'test:business',
  event_type: 'notification.email',
  payload,
  attempts: 0,
  max_attempts: 8,
});

const sealed = (email: object): Record<string, unknown> => ({ sealed: sealProtectedText(JSON.stringify(email)) });

describe('email delivery handler', () => {
  it('opens the sealed message and uses the outbox id as the provider idempotency key', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createEmailDeliveryHandler({ send })(row(sealed({ to: 'ana@example.test', subject: 'Hi', text: 'Body' })));
    expect(send).toHaveBeenCalledWith({ to: 'ana@example.test', subject: 'Hi', text: 'Body', idempotencyKey: 'outbox-1' });
  });

  it('ends the row permanently when email is not configured or the payload is unreadable', async () => {
    await expect(createEmailDeliveryHandler(null)(row(sealed({ to: 'a@b.c', subject: 's', text: 't' })))).rejects.toBeInstanceOf(PermanentOutboxError);
    const send = vi.fn();
    await expect(createEmailDeliveryHandler({ send })(row({ sealed: 'v1.tampered.payload.value' }))).rejects.toBeInstanceOf(PermanentOutboxError);
    await expect(createEmailDeliveryHandler({ send })(row({}))).rejects.toBeInstanceOf(PermanentOutboxError);
    expect(send).not.toHaveBeenCalled();
  });

  it('lets provider outages retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('provider down'));
    const failure = createEmailDeliveryHandler({ send })(row(sealed({ to: 'a@b.c', subject: 's', text: 't' })));
    await expect(failure).rejects.not.toBeInstanceOf(PermanentOutboxError);
  });

  it('never sends queued guest verification or customer lifecycle email rows', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deliver = createEmailDeliveryHandler({ send });
    await expect(deliver({ ...row(sealed({ to: 'guest@example.test', subject: 'Code', text: '123456' })), dedupe_key: 'guest-verification:tenant:guest@example.test' }))
      .rejects.toBeInstanceOf(PermanentOutboxError);
    await expect(deliver({ ...row(sealed({ to: 'guest@example.test', subject: 'Update', text: 'Confirmed' })), dedupe_key: 'reservation-email:id:confirmed:customer' }))
      .rejects.toBeInstanceOf(PermanentOutboxError);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not block unrelated operational email keys that happen to end in customer', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createEmailDeliveryHandler({ send })(
      { ...row(sealed({ to: 'owner@example.test', subject: 'Notice', text: 'Body' })), dedupe_key: 'subscription-email:id:customer' },
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
