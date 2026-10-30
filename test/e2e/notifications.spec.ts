import type { Page, TestInfo } from "@playwright/test";
import {
  notificationFixture,
  notificationId,
} from "../../apps/web/src/features/notifications/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { mockNotifications } from "./support/notifications.ts";
import { notificationEnvelope } from "./support/notifications.ts";
test.use({ trace: "off", screenshot: "off", video: "off" });
// Every API request in this file is controlled by the fictional router.
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await page
      .screenshot({
        path: info.outputPath("controlled-notifications-failure.png"),
        fullPage: true,
        timeout: 3000,
      })
      .catch(() => {});
});
test("uppercase account notification routes keep their authenticated boundary and lookalike prefixes never poll", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await page.goto("/ACCOUNT/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open notifications · Unread: 1/ })).toBeVisible();
  state.pollCalls.length = 0;
  await page.goto("/accounting");
  await expect(page.getByRole("button", { name: /Open notifications/ })).toHaveCount(0);
  expect(state.pollCalls).toEqual([]);
});
const nextId = "e0370000-0000-4000-8000-000000000002";
const toast = (page: Page) => page.locator(".notification-toast");
async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function open(page: Page) {
  await page.goto("/account/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open notifications · Unread: 1/ })).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
test("initial loading keeps unread unknown and never announces a live baseline", async ({
  page,
}, info) => {
  const state = await mockNotifications(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.gate = state.historyGate = gate;
  try {
    await page.goto("/account/notifications");
    await expect(page.getByRole("button", { name: /Unread count unavailable/ })).toBeVisible();
    await expect(page.getByText("Loading notifications…", { exact: true }).first()).toBeVisible();
    await capture(page, info, "notifications-loading");
  } finally {
    state.gate = state.historyGate = null;
    release();
  }
  await expect(page.getByRole("button", { name: /Unread: 1/ })).toBeVisible();
  await expect(page.locator("main .notification-row")).toHaveCount(1);
  await expect(toast(page)).toHaveCount(0);
});
test("an explicitly replayed eligible baseline ID stays silent after a completed refresh", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  await page.getByRole("button", { name: /Open notifications/ }).click();
  const popover = page.getByRole("dialog", { name: "Notifications", exact: true });
  const initial = state.pollCalls.length;
  await refresh(page);
  await expect.poll(() => state.pollCalls.length).toBeGreaterThanOrEqual(initial + 2);
  await expect(popover.getByText("Refreshing…", { exact: true })).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
  state.items = [notificationFixture({ id: nextId })];
  state.cursor = "synthetic-poll-2";
  await refresh(page);
  await expect(toast(page)).toHaveCount(1);
});
test("409 poll checkpoint invalidation silently recovers and read-through requires a new explicit action", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  let rejected = false;
  await page.route("**/api/v1/notifications?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    state.pollCalls.push(cursor);
    if (cursor === "synthetic-poll-1" && !rejected) {
      rejected = true;
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    }
    return route.fulfill({
      json: notificationEnvelope({
        items: state.items,
        nextCursor: state.cursor,
        unreadCount: state.unread,
        hasMore: false,
        serverTime: "2026-10-30T12:01:00.000Z",
      }),
    });
  });
  state.cursor = "synthetic-poll-2";
  await refresh(page);
  await expect.poll(() => rejected).toBe(true);
  await expect(page.getByRole("button", { name: /Unread: 1/ })).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
  state.cursor = "synthetic-poll-3";
  state.commandStatus = 409;
  await page
    .getByRole("button", { name: "Mark all read through last refresh", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Notification state changed");
  await expect
    .poll(() => state.pollCalls.filter((cursor) => cursor === null).length)
    .toBeGreaterThanOrEqual(3);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]?.body).toEqual({ throughCursor: "synthetic-poll-2" });
  state.commandStatus = 200;
  await page
    .getByRole("button", { name: "Mark all read through last refresh", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]?.body).toEqual({ throughCursor: "synthetic-poll-3" });
  expect(state.commands[1]?.key).not.toBe(state.commands[0]?.key);
});
test("history409 discards old pagination before loading a fresh first page", async ({ page }) => {
  const state = await mockNotifications(page);
  state.older = [notificationFixture({ id: nextId })];
  await open(page);
  await expect(page.locator("main .notification-row")).toHaveCount(1);
  state.items = [
    notificationFixture({
      id: "e0370000-0000-4000-8000-000000000003",
      messageKey: "notifications.event.route_changed",
      target: null,
    }),
  ];
  state.historyNextStatus = 409;
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator("main .notification-row")).toHaveCount(1);
  await expect(page.locator("main .notification-row")).toContainText("Route changed:");
  await expect(page.getByText("Starting in about one hour:", { exact: false })).toHaveCount(0);
  expect(state.historyCalls.slice(0, 3)).toEqual([null, "synthetic-history-2", null]);
  expect(state.pollCalls).not.toContain("synthetic-history-2");
  await expect(toast(page)).toHaveCount(0);
});
for (const status of [409, 503, 429])
  test(`failed ${status} baseline after catch-up cannot loop on retained hasMore`, async ({
    page,
  }) => {
    await page.clock.install();
    await mockNotifications(page);
    await open(page);
    let catchup = 0,
      projected = false,
      failures = 0;
    await page.route("**/api/v1/notifications?*", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) {
        catchup++;
        if (catchup > 25)
          return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
      } else if (projected) {
        failures++;
        return route.fulfill({
          status,
          json: { error: { code: "SYNTHETIC_FAILURE" } },
          headers: { "Retry-After": "1" },
        });
      } else projected = true;
      return route.fulfill({
        json: notificationEnvelope({
          items: [notificationFixture()],
          nextCursor: cursor ? `synthetic-catchup-${catchup}` : "synthetic-window-only",
          unreadCount: 1,
          hasMore: !!cursor,
          serverTime: "2026-10-30T12:01:00.000Z",
        }),
      });
    });
    await refresh(page);
    await expect.poll(() => projected).toBe(true);
    await expect(page.getByText("Refreshing…", { exact: true })).toHaveCount(0);
    await page.clock.runFor(1);
    await expect.poll(() => failures).toBe(1);
    expect(catchup).toBe(26);
    // install() still advances wall time between awaits. Freeze at an explicit
    // near-future anchor before checking either side of the thirty-second cadence.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000));
    await page.clock.runFor(10000);
    expect(failures).toBe(1);
    expect(catchup).toBe(26);
    await page.clock.runFor(20000);
    await expect.poll(() => failures).toBe(2);
    expect(catchup).toBe(26);
    await expect(toast(page)).toHaveCount(0);
  });
test("a queued toast claim released after logout cannot publish or persist a claim", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, action: () => boolean) => {
          document.documentElement.dataset.claimWaiting = "true";
          await new Promise<void>((resolve) =>
            window.addEventListener("synthetic-release-claim", () => resolve(), { once: true }),
          );
          return action();
        },
      },
    }),
  );
  state.items = [notificationFixture({ id: nextId })];
  state.cursor = "synthetic-poll-2";
  await refresh(page);
  await expect(page.locator("html")).toHaveAttribute("data-claim-waiting", "true");
  try {
    state.session = false;
    await refresh(page);
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-release-claim")));
  }
  await expect(toast(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("vtc-notification-claims-v1"))).toBeNull();
});
test("a cross-tab preference refresh hint reloads only current scoped server preferences", async ({
  context,
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  const other = await context.newPage();
  await mockNotifications(other);
  await open(other);
  let preferenceReads = 0;
  await other.route("**/api/v1/me/notification-preferences", (route) => {
    preferenceReads++;
    return route.fulfill({
      json: notificationEnvelope(state.prefs),
      headers: { ETag: `"v${state.version}"` },
    });
  });
  const form = page.getByRole("form", { name: "Notification preferences", exact: true });
  await form.getByLabel("Trip starts", { exact: true }).uncheck();
  await form.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Preferences saved.", { exact: true })).toBeVisible();
  await expect(
    other
      .getByRole("form", { name: "Notification preferences", exact: true })
      .getByLabel("Trip starts", { exact: true }),
  ).not.toBeChecked();
  expect(preferenceReads).toBe(1);
  await other.close();
});
test("public, anonymous and foundation surfaces never poll authenticated notifications", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  for (const path of ["/en", "/foundation", "/foundation/member"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /Open notifications/ })).toHaveCount(0);
  }
  state.session = false;
  await page.goto("/account/notifications");
  await catalogLanguage(page);
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  expect(state.pollCalls).toEqual([]);
  expect(state.historyCalls).toEqual([]);
});
test("catch-up advances serial poll pages and fresh projection cannot skip its later checkpoint", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/notifications?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    const next =
      cursor === "synthetic-poll-1"
        ? "synthetic-poll-2"
        : cursor === "synthetic-poll-2"
          ? "synthetic-poll-3"
          : "synthetic-projection-4";
    await route.fulfill({
      json: notificationEnvelope({
        items: [notificationFixture({ id: nextId })],
        nextCursor: next,
        hasMore: cursor === "synthetic-poll-1",
        unreadCount: 1,
        serverTime: "2026-10-30T12:01:00.000Z",
      }),
    });
  });
  await refresh(page);
  await expect.poll(() => cursors.length).toBeGreaterThanOrEqual(3);
  expect(cursors.slice(0, 3)).toEqual(["synthetic-poll-1", "synthetic-poll-2", null]);
  await page
    .getByRole("button", { name: "Mark all read through last refresh", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.body).toEqual({ throughCursor: "synthetic-poll-3" });
});
test("malformed feed fails safely and never displays wire details or a false zero count", async ({
  page,
}) => {
  await mockNotifications(page);
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({
      json: { data: { unreadCount: 0, items: [{ messageKey: "PRIVATE_SENTINEL" }] } },
    }),
  );
  await page.goto("/account/notifications");
  await expect(page.getByRole("button", { name: /Unread count unavailable/ })).toBeVisible();
  await expect(page.getByRole("alert").first()).toContainText("unavailable");
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});
test("access epoch change discards a decoded old feed and establishes a silent new baseline", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  let release = () => {};
  state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.items = [
    notificationFixture({
      id: nextId,
      display: { eventTitle: "Fictional old authority", actorNickname: null, game: "ets2" },
    }),
  ];
  const before = state.pollCalls.length;
  await refresh(page);
  await expect.poll(() => state.pollCalls.length).toBeGreaterThan(before);
  state.epoch++;
  state.items = [];
  state.unread = 0;
  state.cursor = "synthetic-new-scope";
  state.gate = null;
  await refresh(page);
  await expect(page.getByRole("button", { name: /Unread: 0/ })).toBeVisible();
  release();
  await expect(page.getByText("Fictional old authority", { exact: false })).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
});
test("history uses separate pagination, loaded unread filter and bodyless individual reads", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  state.older = [
    notificationFixture({ id: nextId, readAt: "2026-10-30T12:01:00.000Z", target: null }),
  ];
  await open(page);
  await expect(toast(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator("main .notification-row")).toHaveCount(2);
  expect(state.historyCalls).toContain(state.historyCursor);
  expect(state.pollCalls).not.toContain(state.historyCursor);
  await page.getByRole("button", { name: "Unread loaded", exact: true }).click();
  await expect(page.locator("main .notification-row")).toHaveCount(1);
  await expect(page.getByText(/filter covers loaded history only/)).toBeVisible();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByText("No unread notifications in loaded history.", { exact: true }),
  ).toBeVisible();
  expect(state.commands[0]?.raw).toBeNull();
  expect(state.commands[0]?.path).toBe(`/notifications/${notificationId}/read`);
  await expect(page.getByRole("button", { name: /Open notifications · Unread: 0/ })).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
});
test("read through sends accepted poll checkpoint and uncertain retry cannot broaden to later arrivals", async ({
  page,
}) => {
  const started = new Date("2026-10-30T12:00:00Z");
  await page.clock.setFixedTime(started);
  const state = await mockNotifications(page);
  await open(page);
  state.commandStatus = 503;
  const readAll = page.getByRole("button", {
    name: "Mark all read through last refresh",
    exact: true,
  });
  await readAll.click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  const first = state.commands[0];
  state.cursor = "synthetic-poll-2";
  state.items.push(notificationFixture({ id: nextId }));
  state.unread = 2;
  await refresh(page);
  await expect(page.getByRole("button", { name: /Unread: 2/ })).toBeVisible();
  // A durable receipt/cursor does not expire with the generic client retry timer.
  await page.clock.setFixedTime(new Date(started.getTime() + 600001));
  state.commandStatus = 200;
  await readAll.click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(first?.body).toEqual({ throughCursor: "synthetic-poll-1" });
  expect(state.commands[1]?.body).toEqual(first?.body);
  expect(state.commands[1]?.key).toBe(first?.key);
});
test("preferences expose six flags, retain uncertain identity and require explicit conflict reload", async ({
  page,
}, info) => {
  const state = await mockNotifications(page);
  await open(page);
  const form = page.getByRole("form", { name: "Notification preferences", exact: true });
  await expect(form.getByRole("checkbox")).toHaveCount(6);
  await capture(page, info, "notifications-preferences");
  await form.getByLabel("Trip starts", { exact: true }).uncheck();
  state.commandStatus = 503;
  await form.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  state.commandStatus = 200;
  await form.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Preferences saved.", { exact: true })).toBeVisible();
  expect(state.commands[0]?.key).toBe(state.commands[1]?.key);
  expect(state.commands[1]?.etag).toBe('"v1"');
  expect(state.prefs.tripStarted).toBe(false);
  state.commandStatus = 412;
  await form.getByLabel("Event reminders", { exact: true }).uncheck();
  await form.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(form.getByRole("button", { name: "Save preferences", exact: true })).toBeDisabled();
  state.commandStatus = 200;
  state.version++;
  await page.getByRole("button", { name: "Reload preferences", exact: true }).click();
  await expect(form.getByLabel("Event reminders", { exact: true })).toBeChecked();
  await form.getByLabel("Event reminders", { exact: true }).uncheck();
  await form.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Preferences saved.", { exact: true })).toBeVisible();
  expect(state.commands.at(-1)?.key).not.toBe(state.commands[2]?.key);
});
test("pending preferences prevent duplicate commands and preserve the six selected flags", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  const form = page.getByRole("form", { name: "Notification preferences", exact: true });
  await form.getByLabel("Trip starts", { exact: true }).uncheck();
  let release = () => {};
  state.commandGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await form.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(1);
    await expect(form.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(form.getByLabel("Trip starts", { exact: true })).toBeDisabled();
    expect(state.commands[0]?.body).toEqual({ ...state.prefs, tripStarted: false });
  } finally {
    state.commandGate = null;
    release();
  }
  await expect(page.getByText("Preferences saved.", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Trip starts", { exact: true })).not.toBeChecked();
  expect(state.commands).toHaveLength(1);
});
test("visible 30 second polls resume immediately, serialize delayed refresh and suppress baseline/reload toasts", async ({
  page,
}) => {
  await page.clock.install();
  const state = await mockNotifications(page);
  await open(page);
  await expect(toast(page)).toHaveCount(0);
  const initial = state.pollCalls.length;
  state.items = [notificationFixture({ id: nextId })];
  state.cursor = "synthetic-poll-2";
  await page.clock.runFor(30000);
  await expect(toast(page)).toHaveCount(1);
  expect(state.pollCalls.length).toBeGreaterThan(initial);
  await toast(page).getByRole("button", { name: "Dismiss notification", exact: true }).click();
  expect(state.commands).toHaveLength(0);
  await refresh(page);
  await expect(toast(page)).toHaveCount(0);
  let release = () => {};
  state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.pollCalls.length;
  await refresh(page);
  await expect.poll(() => state.pollCalls.length).toBe(before + 1);
  await refresh(page);
  await refresh(page);
  expect(state.pollCalls.length).toBe(before + 1);
  state.gate = null;
  release();
  await expect.poll(() => state.pollCalls.length).toBeGreaterThan(before + 1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toMatch(
    /synthetic-poll|Fictional|eventTitle/,
  );
});
test("hidden and offline pause polls; return coalesces immediate refresh without replay", async ({
  page,
}) => {
  await page.clock.install();
  const state = await mockNotifications(page);
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = state.pollCalls.length;
  await page.clock.runFor(90000);
  expect(state.pollCalls.length).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(30000);
  expect(state.pollCalls.length).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => state.pollCalls.length).toBeGreaterThan(before);
  await expect(toast(page)).toHaveCount(0);
});
for (const status of [429, 503])
  test(`poll ${status} retains safe history and distinguishes unavailable count from zero`, async ({
    page,
  }) => {
    const state = await mockNotifications(page);
    state.status = status;
    await page.goto("/account/notifications");
    await expect(page.getByRole("button", { name: /Unread count unavailable/ })).toBeVisible();
    await expect(page.getByText("PRIVATE_SENTINEL", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    state.status = 200;
    state.items = [];
    state.unread = 0;
    await page.getByRole("button", { name: "Refresh notifications", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /Unread: 0/ })).toBeVisible();
  });
test("bounded re-projection removes stale Open targets and revoked subject records without a session change", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  const bell = page.getByRole("button", { name: /Open notifications/ });
  await bell.click();
  const popover = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(popover.getByRole("link", { name: "Open", exact: true })).toHaveAttribute(
    "href",
    /\/account\/events\//,
  );
  state.items[0] = notificationFixture({ target: null });
  await refresh(page);
  await expect(popover.getByRole("link", { name: "Open", exact: true })).toHaveCount(0);
  await expect(
    popover.getByText("No longer available or you do not have access.", { exact: true }),
  ).toBeVisible();
  state.items = [];
  state.unread = 0;
  await refresh(page);
  await expect(popover.getByText("Starting in about one hour:", { exact: false })).toHaveCount(0);
  await expect(page.locator("main .notification-row")).toHaveCount(0);
});
for (const phase of ["poll", "history", "write"] as const)
  test(`delayed ${phase} beyond logout never restores private notification data`, async ({
    page,
  }) => {
    const state = await mockNotifications(page);
    await open(page);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (phase === "history") {
      state.historyGate = gate;
      await refresh(page);
      await expect.poll(() => state.historyCalls.length).toBeGreaterThan(1);
    } else if (phase === "poll") {
      state.gate = gate;
      state.items = [notificationFixture({ id: nextId })];
      await refresh(page);
      await expect.poll(() => state.pollCalls.filter(Boolean).length).toBeGreaterThan(0);
    } else {
      state.commandGate = gate;
      await page.getByRole("button", { name: "Mark read", exact: true }).click();
      await expect.poll(() => state.commands.length).toBe(1);
    }
    state.session = false;
    await refresh(page);
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    state.gate = state.historyGate = state.commandGate = null;
    release();
    await expect(page.getByText("Fictional Yukon convoy", { exact: false })).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
  });
test("authorization failures hide content immediately while disabled feature does not sign out", async ({
  page,
}) => {
  const state = await mockNotifications(page);
  await open(page);
  state.status = 403;
  await refresh(page);
  await expect(page.locator("main .notification-row")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Unread count unavailable/ })).toBeVisible();
  state.status = 503;
  await page.getByRole("button", { name: "Refresh notifications", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(
    page.getByText("Notifications are unavailable. Please try again.", { exact: true }).first(),
  ).toBeVisible();
});
test("two tabs claim one live toast and denied coordination safely keeps history only", async ({
  context,
  page,
}) => {
  const first = await mockNotifications(page);
  await open(page);
  const other = await context.newPage();
  const second = await mockNotifications(other);
  await open(other);
  first.items = second.items = [notificationFixture({ id: nextId })];
  first.cursor = second.cursor = "synthetic-poll-2";
  await Promise.all([refresh(page), refresh(other)]);
  await expect.poll(async () => (await toast(page).count()) + (await toast(other).count())).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });
  first.items = [notificationFixture({ id: "e0370000-0000-4000-8000-000000000003" })];
  first.cursor = "synthetic-poll-3";
  await refresh(page);
  await expect(page.locator("main .notification-row")).toHaveCount(1);
  await expect(toast(page)).toHaveCount(0);
  await other.close();
});
for (const locale of ["en", "ru"] as const)
  test(`${locale} long safe messages, null/unknown targets, keyboard and responsive review`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await mockNotifications(page, locale);
    state.items = [
      notificationFixture({
        display: {
          eventTitle: `<script>SYNTHETIC_TEXT</script> ${"Fictional long convoy · ".repeat(9)}`,
          actorNickname: "<script>SYNTHETIC_TEXT</script>",
          game: "ats",
        },
      }),
      notificationFixture({ id: nextId, target: null, messageKey: "UNKNOWN_PRIVATE_KEY" }),
      notificationFixture({
        id: "e0370000-0000-4000-8000-000000000003",
        category: "promotion.review_required",
        messageKey: "notifications.promotion.review_required",
        target: { kind: "qualification", id: notificationId },
      }),
    ];
    state.unread = 3;
    await page.goto("/account/notifications");
    await catalogLanguage(page, locale);
    await expect(page.locator("main .notification-row")).toHaveCount(3);
    await expect(page.getByText("UNKNOWN_PRIVATE_KEY")).toHaveCount(0);
    await expect(page.locator("main time").first()).toContainText("Europe/Warsaw");
    await expect(page.locator("main time").first()).toContainText("GMT+01:00");
    await expect(
      page.locator("main").getByText("<script>SYNTHETIC_TEXT</script>", { exact: false }),
    ).toBeVisible();
    await expect(page.locator("main script")).toHaveCount(0);
    await expect(page.locator(`a[href="/account/qualifications?game=ets2"]`)).toBeVisible();
    const bell = page.getByRole("button", {
      name: locale === "en" ? /Open notifications/ : /Открыть уведомления/,
    });
    await bell.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", {
        name: locale === "en" ? "Notifications" : "Уведомления",
        exact: true,
      }),
    ).toBeVisible();
    const historyTarget = await page
      .getByRole("dialog", { name: locale === "en" ? "Notifications" : "Уведомления", exact: true })
      .getByRole("link", {
        name: locale === "en" ? "Notification history" : "История уведомлений",
        exact: true,
      })
      .boundingBox();
    expect(historyTarget?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(bell).toBeFocused();
    const target = await page
      .locator("main")
      .getByRole("link", { name: locale === "en" ? "Open" : "Открыть", exact: true })
      .first()
      .boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await capture(page, info, `notifications-${locale}`);
  });
