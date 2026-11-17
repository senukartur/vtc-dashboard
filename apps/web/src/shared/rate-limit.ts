// Feature failures (AccountFailure and its subclasses) carry `kind` and `retryAfter`.
// The checks are duck-typed so shared code never imports a feature module.

/** True when a request failure is an HTTP 429 rate limit. */
export function isRateLimited(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    (error as { kind: unknown }).kind === "limited"
  );
}

/**
 * The server's exact wait for a rate-limited read, in whole seconds (1-60), or
 * null when unknown. Longer waits are not shortened to fit the read window.
 */
export function rateLimitSeconds(error: unknown): number | null {
  if (!isRateLimited(error) || !("retryAfter" in (error as object))) return null;
  const seconds = (error as { retryAfter: unknown }).retryAfter;
  return typeof seconds === "number" &&
    Number.isSafeInteger(seconds) &&
    seconds >= 1 &&
    seconds <= 60
    ? seconds
    : null;
}
