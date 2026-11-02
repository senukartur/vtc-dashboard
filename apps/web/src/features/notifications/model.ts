import type { components } from "@vtc/contracts";
export type DTO = components["schemas"];
export type Notification = DTO["Notification"];
export const notificationAccountPath = (path: string) => /^\/account(?:\/|$)/i.test(path);
export const preferenceNames = [
  "tripStarted",
  "tripFinished",
  "tripRejected",
  "eventChanges",
  "eventReminders",
  "qualificationChanges",
] as const;
export const messages = [
  "trip.started",
  "trip.finished",
  "trip.cancelled",
  "trip.rejected",
  "trip.review_required",
  "trip.correction_requested",
  "event.start_changed",
  "event.route_changed",
  "event.cancelled",
  "event.reminder",
  "qualification.assigned",
  "qualification.promoted",
  "promotion.eligible",
  "promotion.review_required",
  "application.submitted",
  "application.decided",
  "member.access_changed",
] as const;
export function messageName(item: Notification) {
  return messages.find((name) => item.messageKey === `notifications.${name}`) ?? "unknown";
}
export function notificationTarget(item: Notification): string | null {
  const target = item.target;
  if (!target) return null;
  switch (target.kind) {
    case "trip":
      return `/account/trips/${target.id}`;
    case "event":
      return `/account/events/${target.id}`;
    // The target UUID identifies an assignment, never a member profile.
    case "qualification":
      return item.display.game
        ? `/account/qualifications?game=${item.display.game}`
        : "/account/qualifications";
    case "application":
      return "/account/admin/applications";
    case "member":
      return "/account/admin/members";
  }
}
export interface Attempt {
  identity: string;
  key: string;
  expires: number;
  payload: unknown;
}
export function commandAttempt(
  path: string,
  body: unknown,
  etag: string | null,
  previous: Attempt | null,
  now = Date.now(),
): Attempt {
  const identity = JSON.stringify([path, body, etag]);
  return previous?.identity === identity &&
    (path === "/notifications/read-all" || previous.expires > now)
    ? previous
    : {
        identity,
        key: crypto.randomUUID(),
        expires: now + 600000,
        payload: body === undefined ? undefined : structuredClone(body),
      };
}
export function mergeFeed(previous: Notification[], items: Notification[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()].slice(-50);
}
/** Initial observations are silent even if a later feed repeats an eligible ID. */
export function observeFeed(items: Notification[], seen: Set<string>, baseline: boolean) {
  const live: Notification[] = [];
  for (const item of items) {
    const known = seen.has(item.id);
    seen.delete(item.id);
    seen.add(item.id);
    if (!baseline && !known && !item.readAt && item.liveToastEligible) live.push(item);
  }
  while (seen.size > 512) {
    const oldest = seen.values().next().value;
    if (oldest) seen.delete(oldest);
  }
  return live;
}
export type DayGroup = "today" | "yesterday" | "earlier";
const dayKeyFormats = new Map<string, Intl.DateTimeFormat>();
function dayKey(ms: number, timeZone: string): string {
  let format = dayKeyFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // An invalid display timezone falls back to UTC instead of hiding history.
      return timeZone === "UTC" ? "" : dayKey(ms, "UTC");
    }
    dayKeyFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(ms).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
/** Calendar day of an occurrence relative to `nowMs`, both read in the display timezone. */
export function dayGroup(value: string, nowMs: number, timeZone: string): DayGroup {
  const occurred = Date.parse(value);
  if (!Number.isFinite(occurred) || !Number.isFinite(nowMs)) return "earlier";
  const day = dayKey(occurred, timeZone),
    today = dayKey(nowMs, timeZone);
  if (!day || !today) return "earlier";
  if (day === today) return "today";
  // Step back one calendar day from today's date itself, so DST lengths never matter.
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return day === yesterday.toISOString().slice(0, 10) ? "yesterday" : "earlier";
}
/** Fixed Today/Yesterday/Earlier sections; item order is kept and empty sections are dropped. */
export function groupByDay<T extends { occurredAt: string }>(
  items: readonly T[],
  nowMs: number,
  timeZone: string,
) {
  const groups: Record<DayGroup, T[]> = { today: [], yesterday: [], earlier: [] };
  for (const item of items) groups[dayGroup(item.occurredAt, nowMs, timeZone)].push(item);
  return (["today", "yesterday", "earlier"] as const)
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0);
}
/** Visible bell badge: hidden while unknown or zero, "?" after a failure, capped at 99+. */
export function badgeText(count: number | undefined, failed: boolean): string | null {
  if (failed) return "?";
  if (count === undefined || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
export type NotificationIconName =
  | "truck"
  | "check"
  | "cross"
  | "review"
  | "edit"
  | "calendar"
  | "route"
  | "clock"
  | "award"
  | "up"
  | "document"
  | "user"
  | "dot";
export type NotificationTone = "info" | "accepted" | "rejected" | "pending" | "neutral";
export type NotificationKind = "Trip" | "Event" | "Qualification" | "Administration" | "Other";
type Visual = { icon: NotificationIconName; tone: NotificationTone; kind: NotificationKind };
const visuals: Record<(typeof messages)[number] | "unknown", Visual> = {
  "trip.started": { icon: "truck", tone: "info", kind: "Trip" },
  "trip.finished": { icon: "check", tone: "accepted", kind: "Trip" },
  "trip.cancelled": { icon: "cross", tone: "neutral", kind: "Trip" },
  "trip.rejected": { icon: "cross", tone: "rejected", kind: "Trip" },
  "trip.review_required": { icon: "review", tone: "pending", kind: "Trip" },
  "trip.correction_requested": { icon: "edit", tone: "pending", kind: "Trip" },
  "event.start_changed": { icon: "calendar", tone: "info", kind: "Event" },
  "event.route_changed": { icon: "route", tone: "info", kind: "Event" },
  "event.cancelled": { icon: "calendar", tone: "rejected", kind: "Event" },
  "event.reminder": { icon: "clock", tone: "info", kind: "Event" },
  "qualification.assigned": { icon: "award", tone: "accepted", kind: "Qualification" },
  "qualification.promoted": { icon: "up", tone: "accepted", kind: "Qualification" },
  "promotion.eligible": { icon: "up", tone: "pending", kind: "Qualification" },
  "promotion.review_required": { icon: "review", tone: "pending", kind: "Qualification" },
  "application.submitted": { icon: "document", tone: "neutral", kind: "Administration" },
  "application.decided": { icon: "document", tone: "neutral", kind: "Administration" },
  "member.access_changed": { icon: "user", tone: "neutral", kind: "Administration" },
  unknown: { icon: "dot", tone: "neutral", kind: "Other" },
};
/** Closed icon, tone and category label per registered message; unknown keys get a neutral dot. */
export function notificationVisual(item: Notification): Visual {
  return visuals[messageName(item)];
}
