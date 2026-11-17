import type { components } from "@vtc/contracts";
export type DTO = components["schemas"];
export type Notification = DTO["Notification"];
export const notificationAccountPath = (path: string) => /^\/account(?:\/|$)/i.test(path);
export type PreferenceName = keyof DTO["NotificationPreferences"];
/**
 * Fixed notification settings rows in mockup P14 order (plus the company trip row the owner
 * added). Each row controls every returned preference it groups; `audience` rows are staff-only
 * and carry a muted suffix. Presentation only: the server decides which keys a viewer receives.
 */
export const preferenceGroups = [
  { id: "tripDecision", keys: ["tripAccepted", "tripRejected"] },
  { id: "companyTrips", keys: ["tripStarted", "tripFinished"] },
  { id: "events", keys: ["newEvent", "eventReminders", "eventChanges"] },
  { id: "level", keys: ["qualificationChanges"] },
  { id: "reviewQueue", keys: ["reviewQueue"], audience: true },
  { id: "applications", keys: ["newApplications"], audience: true },
] as const satisfies readonly {
  id: string;
  keys: readonly PreferenceName[];
  audience?: true;
}[];
export type PreferenceGroupId = (typeof preferenceGroups)[number]["id"];
type Same<A, B> = [Exclude<A, B> | Exclude<B, A>] extends [never] ? true : false;
/** Fails to compile when the contract and the rows list different preference keys. */
export const preferenceGroupsComplete: Same<
  PreferenceName,
  (typeof preferenceGroups)[number]["keys"][number]
> = true;
/** A row to render: its returned keys in row order. */
export interface PreferenceRow {
  id: PreferenceGroupId;
  keys: PreferenceName[];
  audience: boolean;
}
/**
 * Rows to render, in display order: a row appears when the read returned at least one of its
 * keys (false counts) and controls only those keys.
 */
export function visibleGroups(data: DTO["NotificationPreferences"]): PreferenceRow[] {
  return preferenceGroups
    .map((group) => ({
      id: group.id,
      keys: group.keys.filter((key) => typeof data[key] === "boolean"),
      audience: "audience" in group,
    }))
    .filter((group) => group.keys.length > 0);
}
export type GroupState = "on" | "off" | "mixed";
/** "mixed" when the row's returned preferences differ, for example set before rows existed. */
export function groupState(
  data: DTO["NotificationPreferences"],
  keys: readonly PreferenceName[],
): GroupState {
  const on = keys.filter((key) => data[key] === true).length;
  return on === keys.length ? "on" : on === 0 ? "off" : "mixed";
}
/**
 * The write for one row change: the read's full key set with every returned key of the row set to
 * `value`. Other rows keep their values and an unreturned key is never added.
 */
export function groupWrite(
  data: DTO["NotificationPreferences"],
  keys: readonly PreferenceName[],
  value: boolean,
): DTO["NotificationPreferences"] {
  const body = { ...data };
  for (const key of keys) if (typeof data[key] === "boolean") body[key] = value;
  return body;
}
/**
 * Translation keys under `details.` for a row's info tooltip, one line each. Some preferences gate
 * more than their name says, so the lines follow what this viewer actually receives: without
 * reviewQueue, tripRejected also covers review notices about own manual reports; with
 * members.manage, eventChanges also covers member access changes; with qualifications.manage,
 * qualificationChanges also covers other members' levels. Presentation only.
 */
export function groupDetails(
  group: PreferenceRow,
  data: DTO["NotificationPreferences"],
  capabilities: readonly string[],
): string[] {
  return group.keys.flatMap((key) => {
    if (key === "tripRejected")
      return [typeof data.reviewQueue === "boolean" ? "tripRejected" : "tripRejectedOwn"];
    if (key === "eventChanges" && capabilities.includes("members.manage"))
      return ["eventChanges", "eventChangesAccess"];
    if (key === "qualificationChanges" && capabilities.includes("qualifications.manage"))
      return ["qualificationChanges", "qualificationChangesStaff"];
    return [key];
  });
}
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
  "application.submitted",
  "application.decided",
  "member.access_changed",
  "trip.accepted",
  "event.published",
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
  "application.submitted": { icon: "document", tone: "neutral", kind: "Administration" },
  "application.decided": { icon: "document", tone: "neutral", kind: "Administration" },
  "member.access_changed": { icon: "user", tone: "neutral", kind: "Administration" },
  "trip.accepted": { icon: "check", tone: "accepted", kind: "Trip" },
  "event.published": { icon: "calendar", tone: "info", kind: "Event" },
  unknown: { icon: "dot", tone: "neutral", kind: "Other" },
};
/** Closed icon, tone and category label per registered message; unknown keys get a neutral dot. */
export function notificationVisual(item: Notification): Visual {
  return visuals[messageName(item)];
}
