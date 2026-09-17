import type { OutboxRow } from '../runner.js';

/**
 * TBF-030 bootstrap events are durable extension points for later consumers. There is no
 * external side effect yet, so acknowledging the row is the correct no-op and prevents the
 * completed tenant graph from being dead-lettered by an unknown event type.
 */
export async function handleTenantBootstrapped(_row: OutboxRow): Promise<void> {
  void _row;
  return Promise.resolve();
}
