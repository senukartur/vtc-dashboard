import { performance } from "node:perf_hooks";

// The jobs supervisor loads this module before spawning its worker, so it must import nothing
// from the application. Both limits count from the supervisor's start: the host tick bounds the
// whole container run, not the worker's share of it.
export const passBounds = Object.freeze({ passMs: 40000, hardMs: 50000 });

const supervisorElapsed = "VTC_JOBS_SUPERVISOR_ELAPSED_MS";

/** Environment a supervisor adds for its worker: how long the supervisor had run before spawning. */
export function workerDeadlineEnv(): Record<string, string> {
  return { [supervisorElapsed]: String(Math.ceil(performance.now())) };
}

/**
 * Monotonic time, on this process's `performance.now()` clock, at which the owning supervisor
 * started. Zero without a supervisor. The spawn gap itself is not counted, so the supervisor's
 * own hard timer still fires first.
 */
export function passOrigin(env: NodeJS.ProcessEnv = process.env): number {
  const spent = Number(env[supervisorElapsed]);
  return Number.isFinite(spent) && spent > 0 ? -Math.min(spent, passBounds.hardMs) : 0;
}

/** Milliseconds left before the hard deadline measured from `origin`. */
export function hardRemainingMs(origin: number): number {
  return Math.max(0, passBounds.hardMs - (performance.now() - origin));
}
