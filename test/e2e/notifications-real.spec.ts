import { randomUUID } from "node:crypto";
import type { components } from "@vtc/contracts";
import { resetAccountLimits, write } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { tripBrowserFixture } from "./support/trips.ts";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.beforeEach(resetAccountLimits);
type Fixture = Awaited<ReturnType<typeof tripBrowserFixture>>;
async function createEvent(fixture: Fixture) {
  const input: components["schemas"]["EventInput"] = {
    title: `Fictional notification convoy ${randomUUID().slice(0, 8)}`,
    description: "Synthetic notification browser integration",
    game: "ets2",
    server: "Fictional Simulation",
    organizer: "Fictional Team",
    route: "Fictional North → Fictional South",
    meetingLocation: "Fictional harbour",
    meetingAt: new Date(Date.now() + 3500000).toISOString(),
    startsAt: new Date(Date.now() + 3570000).toISOString(),
    endsAt: null,
    visibility: "members",
    originCityId: null,
    destinationCityId: null,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
  };
  const events = fixture.composed.events;
  if (!events) throw Error("NOTIFICATION_BROWSER_EVENTS_MISSING");
  const created = await events.create(fixture.staff, randomUUID(), input);
  const id = created.data.event.id;
  return {
    events,
    input,
    id,
    cleanup: async () => {
      const current = await events.get(fixture.staff, id);
      const event = "event" in current.data ? current.data.event : current.data;
      if (event.status === "scheduled")
        await events.cancel(
          fixture.staff,
          id,
          randomUUID(),
          current.version,
          "Synthetic notification fixture cleanup",
        );
    },
  };
}
async function history(fixture: Fixture) {
  const notifications = fixture.composed.notifications;
  if (!notifications) throw Error("NOTIFICATION_BROWSER_COMPOSITION_MISSING");
  return (await notifications.history(fixture.author, { limit: 100 })).items;
}
test("real event reminders, read actions, arrival fence and six preferences persist through built API and MySQL", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await tripBrowserFixture();
  let cleanup = async () => {},
    releaseRead = () => {};
  try {
    expect(
      (
        await write(page.request, "/auth/login", {
          email: fixture.email,
          password: fixture.password,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/account/notifications");
    await catalogLanguage(page);
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark all read through last refresh", exact: true }),
    ).toBeEnabled();
    const event = await createEvent(fixture);
    cleanup = event.cleanup;
    await event.events.respond(fixture.author, event.id, randomUUID(), 1, {
      response: "participating",
    });
    await expect
      .poll(
        async () =>
          (await history(fixture)).some(
            (item) => item.category === "event.reminder" && item.target?.id === event.id,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const row = page.locator("main .notification-row").filter({ hasText: event.input.title });
    await expect(row).toHaveCount(1);
    await expect(page.locator(".event-nearest")).toContainText(event.input.title);
    await expect(row.getByRole("link", { name: "Open", exact: true })).toHaveAttribute(
      "href",
      `/account/events/${event.id}`,
    );
    let release = () => {},
      held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    releaseRead = release;
    await page.route("**/api/v1/notifications/read-all", async (route) => {
      held = true;
      await gate;
      await route.continue();
    });
    await page
      .getByRole("button", { name: "Mark all read through last refresh", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    try {
      await event.events.update(fixture.staff, event.id, randomUUID(), 1, {
        ...event.input,
        route: "Fictional changed route",
      });
      await expect
        .poll(
          async () =>
            (await history(fixture)).some(
              (item) => item.category === "event.route_changed" && item.target?.id === event.id,
            ),
          { timeout: 20000 },
        )
        .toBe(true);
    } finally {
      release();
    }
    await expect
      .poll(async () => {
        const items = await history(fixture);
        return [
          items.find((item) => item.category === "event.reminder" && item.target?.id === event.id)
            ?.readAt !== null,
          items.find(
            (item) => item.category === "event.route_changed" && item.target?.id === event.id,
          )?.readAt === null,
        ];
      })
      .toEqual([true, true]);
    const changed = page
      .locator("main .notification-row")
      .filter({ hasText: `Route changed: ${event.input.title}` });
    await expect(changed).toHaveCount(1);
    await changed.getByRole("button", { name: "Mark read", exact: true }).click();
    await expect(changed.getByRole("button", { name: "Mark read", exact: true })).toHaveCount(0);
    const form = page.getByRole("form", { name: "Notification preferences", exact: true });
    await expect(form.getByRole("checkbox")).toHaveCount(6);
    await form.getByLabel("Event reminders", { exact: true }).uncheck();
    await form.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(page.getByText("Preferences saved.", { exact: true })).toBeVisible();
    await page.reload();
    await catalogLanguage(page);
    await expect(form.getByLabel("Event reminders", { exact: true })).not.toBeChecked();
    await expect(page.locator(".notification-toast")).toHaveCount(0);
    const response = await page.request.get("/api/v1/me/notification-preferences");
    expect(response.status()).toBe(200);
    expect((await response.json()).data.eventReminders).toBe(false);
  } finally {
    releaseRead();
    try {
      await cleanup();
    } finally {
      await fixture.close();
    }
  }
});
test("real unanswered members retain nearest event independently of reminders; cancellation refreshes header", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const fixture = await tripBrowserFixture();
  const other = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: page.viewportSize(),
    serviceWorkers: "block",
  });
  let cleanup = async () => {};
  try {
    const event = await createEvent(fixture),
      credentials = await fixture.newMember();
    cleanup = event.cleanup;
    expect(
      (
        await write(other.request, "/auth/login", {
          email: credentials.email,
          password: credentials.password,
        })
      ).status(),
    ).toBe(200);
    const unanswered = await other.newPage();
    await unanswered.goto("/account/notifications");
    await catalogLanguage(unanswered);
    await expect(unanswered.locator(".event-nearest")).toContainText(event.input.title);
    const items = (
      await (await unanswered.request.get("/api/v1/notifications/history?limit=100")).json()
    ).data.items as components["schemas"]["Notification"][];
    expect(
      items.some((item) => item.category === "event.reminder" && item.target?.id === event.id),
    ).toBe(false);
    await event.events.cancel(fixture.staff, event.id, randomUUID(), 1, "Synthetic cancellation");
    await unanswered.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(unanswered.locator(".event-nearest")).not.toContainText(event.input.title);
  } finally {
    try {
      await cleanup();
    } finally {
      await other.close();
      await fixture.close();
    }
  }
});
test("real session revocation discards an already authorized held feed response", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await tripBrowserFixture();
  let release = () => {};
  try {
    expect(
      (
        await write(page.request, "/auth/login", {
          email: fixture.email,
          password: fixture.password,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/account/notifications");
    await catalogLanguage(page);
    await expect(
      page.getByRole("button", { name: "Mark all read through last refresh", exact: true }),
    ).toBeEnabled();
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/notifications?*", async (route) => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held).toBe(true);
    expect((await write(page.request, "/auth/logout")).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    release();
    await expect(page.locator(".notification-row,.notification-toast")).toHaveCount(0);
    expect((await page.request.get("/api/v1/notifications")).status()).toBe(401);
  } finally {
    release();
    await fixture.close();
  }
});
