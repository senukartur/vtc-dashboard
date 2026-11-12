const hourMs = 60 * 60 * 1000;

export function displayTimezone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function wallClock(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (instant: number) => {
    const { year, month, day, hour, minute, second } = Object.fromEntries(
      formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    return `${year?.padStart(4, "0")}-${month}-${day}T${hour}:${minute}:${second}`;
  };
}

export function referenceLocalValue(saved: string | undefined, timezone: string): string {
  return saved ? wallClock(timezone)(Date.parse(saved)).slice(0, 16) : "";
}

/**
 * Resolve the entered wall-clock minute in the account zone. Matching the original display
 * preserves both sub-minute precision and the saved side of a repeated minute. New repeated
 * minutes resolve to the earlier instant. A minute that does not exist has no candidate.
 */
export function referenceInstant(
  local: string,
  timezone: string,
  saved?: string,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || local.startsWith("0000-")) return undefined;
  const wall = `${local}:00.000Z`;
  const naive = Date.parse(wall);
  if (!Number.isFinite(naive) || new Date(naive).toISOString() !== wall) return undefined;

  const render = wallClock(timezone);
  if (saved && render(Date.parse(saved)).slice(0, 16) === local)
    return new Date(saved).toISOString();

  const candidates = new Set<number>();
  // Collect the offsets on both sides of a transition, including skipped dates and fractional
  // hour shifts. Then require each candidate to round-trip through the zone.
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = naive + hours * hourMs;
    const offset = Date.parse(`${render(sample)}Z`) - sample;
    const candidate = naive - offset;
    if (Number.isFinite(candidate) && render(candidate) === wall.slice(0, 19))
      candidates.add(candidate);
  }
  return candidates.size ? new Date(Math.min(...candidates)).toISOString() : undefined;
}
