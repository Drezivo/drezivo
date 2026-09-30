import { describe, expect, it, vi } from 'vitest';

import { sealProtectedText } from '../../../shared/protected-recipient.js';
import { PermanentOutboxError, type OutboxRow } from '../../runner.js';
import { createEmailDeliveryHandler } from '../email-delivery.js';

const row = (payload: Record<string, unknown>): OutboxRow => ({
  id: 'outbox-1',
  tenant_id: 'tenant-1',
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
});
