import type { components } from "@vtc/contracts";
export type DTO = components["schemas"];
export function periodFrom(value: string | null): "upcoming" | "past" {
  return value === "past" ? "past" : "upcoming";
}
export function utcInput(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const result = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(3, "0")}Z`;
  const time = Date.parse(result);
  return Number.isFinite(time) && new Date(time).toISOString() === result ? result : undefined;
}
export function responseInput(
  response: DTO["Rsvp"]["response"],
  reason: string,
): DTO["RsvpInput"] | undefined {
  return response === "declined"
    ? reason.trim()
      ? { response, reason: reason.trim() }
      : undefined
    : { response };
}
export function eventTime(value: string, locale: string, timezone: string): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value))} · ${timezone} · ${new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(new Date(value)).find((p) => p.type === "timeZoneName")?.value ?? "UTC"}`;
}
export type Attempt = { fingerprint: string; key: string };
export function commandAttempt(
  method: string,
  path: string,
  body: unknown,
  etag: string | null,
  previous: Attempt | null,
): Attempt {
  const fingerprint = JSON.stringify([method, path, body, etag]);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID() };
}
