// Pure view model for the compact events list and event detail (VTC-058). It only decides what the
// pages show; request paths, bodies, keys, ETags and command state stay in the page components.
import { type DTO, timezoneOffset } from "./model.js";

export type EventPhase = "open" | "started" | "cancelled" | "completed";

/**
 * Responses are open only for a scheduled event before its start. The start instant itself counts
 * as started, matching the server's response cutoff.
 */
export function eventPhase(
  event: Pick<DTO["EventPublic"], "status" | "startsAt">,
  now: number,
): EventPhase {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "completed") return "completed";
  return Date.parse(event.startsAt) <= now ? "started" : "open";
}

export type ResponseValue = DTO["Rsvp"]["response"];
/** Symbols stay within the font coverage set (✓ U+2713, ✕ U+2715, ◇ U+25C7). */
export function responseTone(response: ResponseValue): {
  tone: ResponseValue;
  symbol: "✓" | "✕" | "◇";
} {
  return {
    tone: response,
    symbol: response === "participating" ? "✓" : response === "declined" ? "✕" : "◇",
  };
}

/** Translation key of the response choice label. */
export function responseChoiceKey(response: ResponseValue) {
  return response === "participating"
    ? "participating"
    : response === "declined"
      ? "choiceDeclined"
      : "choiceUnanswered";
}

/** Day of month and short month of `startsAt` in the display timezone. */
export function dateTile(startsAt: string, locale: string, timezone: string) {
  const at = new Date(startsAt);
  return {
    day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: timezone }).format(at),
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone: timezone }).format(at),
  };
}

/** "Europe/Warsaw (GMT+02:00)": the zone with its offset at `at`. */
export function timezoneLabel(timezone: string, at: string | number) {
  return `${timezone} (${timezoneOffset(at, timezone)})`;
}

/** Weekday, date and time with the offset at that instant, for list rows. */
export function compactTime(value: string, locale: string, timezone: string) {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
  return `${text} · ${timezoneOffset(value, timezone)}`;
}

export type PrescribedLoad = Pick<
  DTO["EventMember"],
  "prescribedCargoId" | "prescribedMassKg" | "prescribedTrailerTypeId"
>;
export function hasPrescribedLoad(member: PrescribedLoad) {
  return (
    member.prescribedCargoId !== null ||
    member.prescribedMassKg !== null ||
    member.prescribedTrailerTypeId !== null
  );
}
/** The event-load exception note applies only to a prescribed load of an event not cancelled. */
export function showException(member: PrescribedLoad & { event: { status: string } }) {
  return hasPrescribedLoad(member) && member.event.status !== "cancelled";
}

export type CountsView =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; participating: number; declined: number };
/** A failed or missing counts read is "unavailable", never zero. */
export function countsView(query: {
  isPending: boolean;
  isError: boolean;
  data?: DTO["EventResponseCounts"] | undefined;
}): CountsView {
  if (query.isError) return { state: "unavailable" };
  if (query.data) return { state: "ready", ...query.data };
  return query.isPending ? { state: "loading" } : { state: "unavailable" };
}

export function memberLabel(summary: DTO["MemberSummary"], selfId: string | null | undefined) {
  return { self: !!selfId && summary.id === selfId, former: summary.formerMember };
}
