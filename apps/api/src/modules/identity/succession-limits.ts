// Leadership-transfer code issuance policy: a new code no sooner than 60 seconds
// after the previous one and at most five codes in any 60-minute period.
export const SUCCESSION_RESEND_COOLDOWN_MS = 60000;
export const SUCCESSION_WINDOW_MS = 3600000;
export const SUCCESSION_CODES_PER_WINDOW = 5;

export interface SuccessionWindow {
  allowed: boolean;
  /** Earliest instant a new code may be issued; null when one may be issued now. */
  resendAvailableAt: Date | null;
}

/**
 * Decides whether another succession code may be issued at `now`.
 *
 * Boundaries are inclusive of the release instant: a request exactly 60 000 ms
 * after the latest issuance passes the cooldown. The hourly window is half-open,
 * `(now - 60 min, now]`, so an issuance exactly 60 minutes old no longer counts.
 * When five or more issuances fall inside the window, the next code becomes
 * available when the oldest of the latest five leaves it.
 */
export function successionWindow(issuedAt: readonly Date[], now: Date): SuccessionWindow {
  const current = now.getTime();
  const times = issuedAt.map((value) => value.getTime()).sort((a, b) => a - b);
  let availableAt = Number.NEGATIVE_INFINITY;
  const latest = times.at(-1);
  if (latest !== undefined) availableAt = latest + SUCCESSION_RESEND_COOLDOWN_MS;
  const recent = times.filter((value) => value > current - SUCCESSION_WINDOW_MS);
  if (recent.length >= SUCCESSION_CODES_PER_WINDOW) {
    const oldestOfLastFive = recent[recent.length - SUCCESSION_CODES_PER_WINDOW] as number;
    availableAt = Math.max(availableAt, oldestOfLastFive + SUCCESSION_WINDOW_MS);
  }
  return current >= availableAt
    ? { allowed: true, resendAvailableAt: null }
    : { allowed: false, resendAvailableAt: new Date(availableAt) };
}
