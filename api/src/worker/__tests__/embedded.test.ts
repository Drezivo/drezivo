import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWorkerEntry, startEmbeddedWorker, type EmbeddedWorkerHandle } from '../embedded.js';

/**
 * The supervisor is exercised against tiny stub child scripts instead of the real worker, so the
 * test proves the process contract (environment, restart, signal forwarding) without a database.
 */
let dir: string;
let handle: EmbeddedWorkerHandle | null = null;

const WORKER_URL = 'postgres://drezivo_worker:secret@127.0.0.1:5432/drezivo';

beforeEach(() => {
  dir = mkdtempSync(join(process.env.TEMP ?? tmpdir(), 'embedded-worker-'));
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
  rmSync(dir, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('embedded worker supervisor', () => {
  it('forks the worker with its own database URL, a small pool, and continuous mode', async () => {
    const out = join(dir, 'env.json');
    const script = join(dir, 'stub.mjs');
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
       const pick = ['DATABASE_URL','WORKER_MODE','WORKER_ENABLED','DATABASE_POOL_MAX','EMBEDDED_WORKER','WORKER_DATABASE_URL'];
       writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.fromEntries(pick.map((k) => [k, process.env[k] ?? null]))));
       setInterval(() => {}, 1000);`,
    );
    handle = startEmbeddedWorker({
      entry: script,
      workerDatabaseUrl: WORKER_URL,
      baseEnv: { ...process.env, DATABASE_URL: 'postgres://drezivo_app:x@127.0.0.1/drezivo', WORKER_DATABASE_URL: WORKER_URL, EMBEDDED_WORKER: 'true' },
    });
    await waitFor(() => existsSync(out) && readFileSync(out, 'utf8').length > 0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      DATABASE_URL: WORKER_URL,
      WORKER_MODE: 'continuous',
      WORKER_ENABLED: 'true',
      DATABASE_POOL_MAX: '3',
      EMBEDDED_WORKER: 'false',
      WORKER_DATABASE_URL: null,
    });
  });

  it('restarts a crashed worker with backoff and stops restarting once stopped', async () => {
    const script = join(dir, 'crash.mjs');
    writeFileSync(script, 'process.exit(3);');
    handle = startEmbeddedWorker({ entry: script, workerDatabaseUrl: WORKER_URL, initialBackoffMs: 10, maxBackoffMs: 40 });
    await waitFor(() => (handle?.starts ?? 0) >= 3);
    await handle.stop();
    const startsAtStop = handle.starts;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(handle.starts).toBe(startsAtStop);
  });

  it('forwards the shutdown signal and resolves once the child has exited', async () => {
    const marker = join(dir, 'ready');
    const script = join(dir, 'long.mjs');
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
       writeFileSync(${JSON.stringify(marker)}, 'ready');
       setInterval(() => {}, 1000);`,
    );
    handle = startEmbeddedWorker({ entry: script, workerDatabaseUrl: WORKER_URL, initialBackoffMs: 10 });
    await waitFor(() => existsSync(marker));
    await handle.stop('SIGTERM');
    expect(handle.starts).toBe(1);
  });

  it('resolves the worker entry next to the server for compiled and tsx runs', () => {
    const base = join(dir, 'server');
    expect(resolveWorkerEntry(pathToFileURL(`${base}.js`).href)).toBe(join(dir, 'worker.js'));
    expect(resolveWorkerEntry(pathToFileURL(`${base}.ts`).href)).toBe(join(dir, 'worker.ts'));
  });
});
