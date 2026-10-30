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
