// Pure view model for company settings and the leadership transfer panel. It only decides what
// the page shows; request paths, bodies, keys and command state stay in SettingsPage. Every
// countdown is derived from server values (`expiresAt`, `resendAvailableAt`, Retry-After).

/** Whole seconds until `iso`, rounded up; 0 when past, missing or invalid. */
export function secondsUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** ASCII "m:ss" for a non-negative number of seconds. */
export function countdown(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type PendingCode = { expiresAt: string; attemptsRemaining: number };
export type LeadershipView = {
  step: "successor" | "code";
  /** The server-reported code passed its expiry on this clock. */
  expired: boolean;
  /** A requested code is no longer reported by the server (used up, replaced or expired). */
  gone: boolean;
  codeUsable: boolean;
  attemptsLeft: number | null;
  expiresIn: number;
  resendIn: number;
  canRequest: boolean;
};

/**
 * `pending` is the server's current usable code. `requested` is true while this page still shows a
 * code it requested or restored, so a code the server no longer reports stays on the code step
 * with an explanation instead of silently returning to the successor choice. `changing` is the
 * explicit Change successor choice. `resendIn` is the later of the server's `resendAvailableAt` and
 * the transport's Retry-After wait.
 */
export function leadershipView(input: {
  pending: PendingCode | null;
  requested: boolean;
  changing: boolean;
  resendAvailableAt: string | null;
  requestSeconds: number;
  now: number;
}): LeadershipView {
  const { pending, now } = input;
  const expiresIn = pending ? secondsUntil(pending.expiresAt, now) : 0,
    expired = !!pending && expiresIn === 0,
    attemptsLeft = pending ? pending.attemptsRemaining : null,
    resendIn = Math.max(
      secondsUntil(input.resendAvailableAt, now),
      Math.max(0, Math.ceil(input.requestSeconds)),
    );
  return {
    step: !input.changing && (pending || input.requested) ? "code" : "successor",
    expired,
    gone: !pending && input.requested,
    codeUsable: !!pending && !expired && (attemptsLeft ?? 0) > 0,
    attemptsLeft,
    expiresIn,
    resendIn,
    canRequest: resendIn === 0,
  };
}

export const readinessCodes = [
  "company_reporting_timezone",
  "qualification_configuration",
] as const;
export type ReadinessItem = { code: string; ok: boolean; known: boolean };

/** Known setup items first (in a fixed order), then any unknown missing codes as incomplete. */
export function readinessItems(input: {
  reportingTimezone: string | null;
  missingSetup: readonly string[];
}): ReadinessItem[] {
  const missing = new Set(input.missingSetup);
  return [
    ...readinessCodes.map((code) => ({
      code,
      ok:
        !missing.has(code) && (code !== "company_reporting_timezone" || !!input.reportingTimezone),
      known: true,
    })),
    ...[...missing]
      .filter((code) => !(readinessCodes as readonly string[]).includes(code))
      .map((code) => ({ code, ok: false, known: false })),
  ];
}

/** A deferred adapter is "unavailable" at runtime regardless of its runtime flag. */
export function sourceBadges(source: { implemented: boolean; runtimeEnabled: boolean }): {
  implemented: "implemented" | "planned";
  runtime: "enabled" | "disabled" | "unavailable";
} {
  return {
    implemented: source.implemented ? "implemented" : "planned",
    runtime: !source.implemented ? "unavailable" : source.runtimeEnabled ? "enabled" : "disabled",
  };
}
