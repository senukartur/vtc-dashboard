import type { DTO, Notification } from "./model.js";
export const notificationId = "e0370000-0000-4000-8000-000000000001";
/** A Stage 4 member read: the six original switches plus tripAccepted and newEvent. */
export const notificationPreferences: DTO["NotificationPreferences"] = {
  tripStarted: true,
  tripFinished: true,
  tripRejected: true,
  eventChanges: true,
  eventReminders: true,
  qualificationChanges: true,
  tripAccepted: true,
  newEvent: true,
};
/** The read a viewer with these capabilities receives, in the server's key order. */
export function notificationPreferencesFor(
  capabilities: readonly string[],
): DTO["NotificationPreferences"] {
  const { tripAccepted, newEvent, ...original } = notificationPreferences;
  return {
    ...original,
    ...(capabilities.includes("trips.review") ? { reviewQueue: true } : {}),
    ...(capabilities.includes("applications.manage") ? { newApplications: true } : {}),
    tripAccepted: tripAccepted ?? true,
    newEvent: newEvent ?? true,
  };
}
export function notificationFixture(overrides: Partial<Notification> = {}): Notification {
  return {
    id: notificationId,
    category: "event.reminder",
    messageKey: "notifications.event.reminder",
    display: { actorNickname: null, eventTitle: "Fictional Yukon convoy", game: "ets2" },
    occurredAt: "2026-10-30T12:00:00.000Z",
    readAt: null,
    target: { kind: "event", id: "e0350000-0000-4000-8000-000000000001" },
    liveToastEligible: true,
    ...overrides,
  };
}
export function notificationFeed(items: Notification[] = []): DTO["NotificationFeed"] {
  return {
    items,
    nextCursor: "synthetic-poll-checkpoint",
    hasMore: false,
    serverTime: "2026-10-30T12:01:00.000Z",
    unreadCount: items.filter((item) => !item.readAt).length,
  };
}
