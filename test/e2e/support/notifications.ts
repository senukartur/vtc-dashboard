import type { Page, Route } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import {
  notificationFeed,
  notificationFixture,
  notificationId,
  notificationPreferences,
} from "../../../apps/web/src/features/notifications/fixtures.ts";
import type { DTO, Notification } from "../../../apps/web/src/features/notifications/model.ts";
export const notificationEnvelope = (data: unknown) => ({
  data,
  meta: { requestId: "synthetic-notifications" },
});
export function inertNotifications(route: Route) {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() !== "GET") return;
  const data =
    path === "/api/v1/notifications"
      ? notificationFeed()
      : path === "/api/v1/notifications/history"
        ? { items: [], nextCursor: null }
        : path === "/api/v1/me/notification-preferences"
          ? notificationPreferences
          : undefined;
  if (data) return route.fulfill({ json: notificationEnvelope(data), headers: { ETag: '"v1"' } });
}
export async function mockNotifications(page: Page, locale: "en" | "ru" = "en") {
  const state = {
    items: [notificationFixture()] as Notification[],
    older: [] as Notification[],
    cursor: "synthetic-poll-1",
    historyCursor: "synthetic-history-2",
    unread: 1,
    hasMore: false,
    pollCalls: [] as (string | null)[],
    historyCalls: [] as (string | null)[],
    commands: [] as {
      path: string;
      body: unknown;
      raw: string | null;
      key: string | undefined;
      etag: string | undefined;
    }[],
    prefs: structuredClone(notificationPreferences),
    version: 1,
    status: 200,
    prefStatus: 200,
    commandStatus: 200,
    session: true,
    capabilities: ["company.read", "events.respond", "trips.submit_own"],
    epoch: 1,
    gate: null as Promise<void> | null,
    historyGate: null as Promise<void> | null,
    historyNextStatus: 200,
    commandGate: null as Promise<void> | null,
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", "");
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        json:
          status === 200
            ? notificationEnvelope(data)
            : { error: { code: "PRIVATE_SENTINEL", message: "Private synthetic diagnostic" } },
        headers: { ETag: `"v${state.version}"`, "Retry-After": "1" },
      });
    if (path === "/me") {
      const self = accountFixture(locale).data;
      self.capabilities = state.capabilities;
      self.identityEpoch = state.epoch;
      self.preferences.displayTimezone = "Europe/Warsaw";
      return reply(self, state.session ? 200 : 401);
    }
    if (path === "/auth/csrf") return reply({ token: "NONFUNCTIONAL_FIXTURE" });
    if (path === "/auth/logout") {
      state.session = false;
      return reply({ id: notificationId, version: 1 });
    }
    if (path === "/me/upcoming-event") return reply(null);
    if (path === "/notifications" && request.method() === "GET") {
      const cursor = url.searchParams.get("cursor");
      state.pollCalls.push(cursor);
      const feed = {
        ...notificationFeed(structuredClone(state.items)),
        nextCursor: state.cursor,
        unreadCount: state.unread,
        hasMore: cursor ? state.hasMore : false,
      };
      const status = state.status;
      if (state.gate) await state.gate;
      return reply(feed, status);
    }
    if (path === "/notifications/history") {
      state.historyCalls.push(url.searchParams.get("cursor"));
      if (url.searchParams.has("cursor") && state.historyNextStatus !== 200)
        return reply(null, state.historyNextStatus);
      const data = {
        items: structuredClone(url.searchParams.has("cursor") ? state.older : state.items).map(
          (item) => ({ ...item, liveToastEligible: false }),
        ),
        nextCursor:
          !url.searchParams.has("cursor") && state.older.length ? state.historyCursor : null,
      };
      if (state.historyGate) await state.historyGate;
      return reply(data, state.status);
    }
    if (path === "/me/notification-preferences" && request.method() === "GET")
      return reply(state.prefs, state.prefStatus);
    if (request.method() === "POST" || request.method() === "PUT") {
      const body = request.postData() ? request.postDataJSON() : undefined;
      state.commands.push({
        path,
        body,
        raw: request.postData(),
        key: request.headers()["idempotency-key"],
        etag: request.headers()["if-match"],
      });
      if (state.commandGate) await state.commandGate;
      if (state.commandStatus !== 200) return reply(null, state.commandStatus);
      if (path === "/me/notification-preferences") {
        state.prefs = body as DTO["NotificationPreferences"];
        state.version++;
        return reply(state.prefs);
      }
      for (const item of state.items)
        if (path.endsWith(`/${item.id}/read`) || path === "/notifications/read-all")
          item.readAt = "2026-10-30T12:02:00.000Z";
      state.unread = state.items.filter((item) => !item.readAt).length;
      return reply({ id: notificationId, version: 1 });
    }
    return reply(null, 503);
  });
  return state;
}
