import { logger } from '../shared/logger.js';

export interface Sweep {
  name: string;
  run: () => Promise<unknown>;
  intervalMs: number;
  fast?: true;
}

/** Runs each maintenance sweep without overlapping another run of the same sweep. */
export function startSweepScheduler(sweeps: readonly Sweep[]): { stop: () => Promise<void> } {
  const states = sweeps.map((sweep) => ({
    sweep,
    active: null as Promise<void> | null,
    runs: 0,
    failures: 0,
    skipped: 0,
    durationMs: 0,
  }));
  const timers = states.map((state) => setInterval(() => {
    if (state.active) {
      state.skipped += 1;
      return;
    }
    const startedAt = Date.now();
    state.runs += 1;
    state.active = Promise.resolve()
      .then(() => state.sweep.run())
      .then(() => undefined)
      .catch((error: unknown) => {
        state.failures += 1;
        const candidate = error instanceof Error ? error.name : 'UnknownError';
        const errorType = /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(candidate) ? candidate : 'UnknownError';
        logger.error({ sweep: state.sweep.name, errorType }, 'worker sweep failed; will retry on next interval');
      })
      .finally(() => {
        state.durationMs += Date.now() - startedAt;
        state.active = null;
      });
  }, state.sweep.intervalMs));

  const reportTimer = setInterval(() => {
    logger.info({
      sweeps: states.map(({ sweep, runs, failures, skipped, durationMs }) => ({
        name: sweep.name, runs, failures, skipped, durationMs,
      })),
    }, 'worker sweep activity');
    for (const state of states) {
      state.runs = 0;
      state.failures = 0;
      state.skipped = 0;
      state.durationMs = 0;
    }
  }, 300_000);

  return {
    async stop() {
      timers.forEach(clearInterval);
      clearInterval(reportTimer);
      await Promise.all(states.flatMap((state) => state.active ? [state.active] : []));
    },
  };
}
