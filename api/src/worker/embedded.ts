import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../shared/logger.js';

/**
 * Embedded worker supervisor (pilot hosting). The API process forks the ordinary worker entrypoint
 * (`worker.js`, same compiled code as the dedicated worker service) as a child process with its
 * own database role and a small pool, restarts it with capped exponential backoff when it exits,
 * and forwards SIGTERM/SIGINT so a deploy shuts both down cleanly.
 *
 * Reversible by configuration only: EMBEDDED_WORKER=false plus the dedicated worker service
 * (docs/runbooks/worker-cloud-run.md). Crash-surviving work already lives in the outbox with lease
 * claims, so a child restart never loses a job; it only delays it.
 *
 * The child's DATABASE_URL is replaced by WORKER_DATABASE_URL. Connection strings are never logged.
 */

export interface EmbeddedWorkerOptions {
  /** Absolute path of the worker entry file to fork. */
  entry: string;
  workerDatabaseUrl: string;
  /** Environment the child inherits before the overrides below. Defaults to this process's env. */
  baseEnv?: NodeJS.ProcessEnv;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** A child that stayed up this long is considered healthy; the next crash restarts the backoff. */
  healthyAfterMs?: number;
  forkImpl?: (modulePath: string, args: readonly string[], options: ForkOptions) => ChildProcess;
}

export interface EmbeddedWorkerHandle {
  /** Stops restarting, signals the child, and resolves when it has exited. */
  stop(signal?: NodeJS.Signals): Promise<void>;
  /** Number of times the child has been started (1 = first start). */
  readonly starts: number;
}

/** `worker.js` next to the compiled server, or `worker.ts` when the server runs under tsx. */
export function resolveWorkerEntry(serverModuleUrl: string): string {
  const serverPath = fileURLToPath(serverModuleUrl);
  return join(dirname(serverPath), `worker${extname(serverPath)}`);
}

export function startEmbeddedWorker(options: EmbeddedWorkerOptions): EmbeddedWorkerHandle {
  const initialBackoffMs = options.initialBackoffMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 60_000;
  const healthyAfterMs = options.healthyAfterMs ?? 60_000;
  const forkImpl = options.forkImpl ?? fork;

  let child: ChildProcess | null = null;
  let stopping = false;
  let starts = 0;
  let backoffMs = initialBackoffMs;
  let restartTimer: NodeJS.Timeout | null = null;
  let exited: Promise<void> = Promise.resolve();

  const spawn = (): void => {
    starts += 1;
    const startedAt = Date.now();
    const env: NodeJS.ProcessEnv = {
      ...(options.baseEnv ?? process.env),
      DATABASE_URL: options.workerDatabaseUrl,
      WORKER_MODE: 'continuous',
      WORKER_ENABLED: 'true',
      DATABASE_POOL_MAX: '3',
      // The child is the worker; it must never start a supervisor of its own.
      EMBEDDED_WORKER: 'false',
    };
    delete env.WORKER_DATABASE_URL;

    const current = forkImpl(options.entry, [], { env, stdio: 'inherit' });
    child = current;
    exited = new Promise<void>((resolve) => {
      current.once('exit', (code, signal) => {
        if (child === current) child = null;
        resolve();
        if (stopping) {
          logger.info({ code, signal }, 'embedded worker stopped');
          return;
        }
        if (Date.now() - startedAt >= healthyAfterMs) backoffMs = initialBackoffMs;
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
        logger.error({ code, signal, restartInMs: delay }, 'embedded worker exited; restarting');
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (!stopping) spawn();
        }, delay);
      });
    });
    current.once('error', (error) => {
      logger.error({ err: { name: error.name, message: error.message } }, 'embedded worker process error');
    });
    logger.info({ pid: current.pid, start: starts }, 'embedded worker started');
  };

  spawn();

  return {
    get starts() {
      return starts;
    },
    async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
      stopping = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const running = child;
      if (running && running.exitCode === null && running.signalCode === null) {
        running.kill(signal);
        await exited;
      }
    },
  };
}
