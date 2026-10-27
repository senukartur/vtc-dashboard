import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions, Page, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { tripBrowserFixture } from "./support/trips.ts";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.beforeEach(resetAccountLimits);
async function create(
  page: Page,
  title: string,
  visibility: "public" | "members",
  started = false,
  fixture?: Awaited<ReturnType<typeof tripBrowserFixture>>,
) {
  await page.goto("/account/events/new");
  await catalogLanguage(page);
  await page.getByLabel("Event title", { exact: true }).fill(title);
  for (const [label, value] of [
    ["Server", "Fictional Simulation"],
    ["Organizer", "Fictional Yukon Team"],
    ["Route", "Fictional North → Fictional South"],
    ["Meeting location", "Fictional harbour"],
  ])
    await page.getByLabel(label as string, { exact: true }).fill(value as string);
  await page.getByLabel("Description", { exact: true }).fill("Synthetic event UI verification.");
  await page.getByLabel("Visibility", { exact: true }).selectOption(visibility);
  const start = new Date(Date.now() + (started ? -60000 : 86400000)).toISOString().slice(0, 16),
    meeting = new Date(Date.parse(`${start}Z`) - 60000).toISOString().slice(0, 16);
  await page.getByLabel("Meeting time (UTC)", { exact: true }).fill(meeting);
  await page.getByLabel("Start time (UTC)", { exact: true }).fill(start);
  if (fixture) {
    await page.getByRole("button", { name: "Choose catalog selections", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Prescribed cargo", exact: true })
      .selectOption(fixture.ids.fixture_crates as string);
    await page
      .getByRole("combobox", { name: "Prescribed trailer type", exact: true })
      .selectOption(fixture.ids.fixture_trailer as string);
    await page.getByLabel("Prescribed mass (kg) · Optional", { exact: true }).fill("21000");
  }
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  return new URL(page.url()).pathname.split("/").at(-1) as string;
}

async function scenario(browser: Browser, page: Page, info: TestInfo, name: string) {
  const fixture = await tripBrowserFixture(),
    staff = await staffContext(),
    contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const device: Pick<BrowserContextOptions, "viewport" | "isMobile" | "hasTouch"> = {
    viewport: page.viewportSize(),
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  };
  const counts = {
    started: 0,
    completed: 0,
    failed: 0,
    limited: 0,
    headerStarts: 0,
    catalogStarts: 0,
  };
  function observe(p: Page) {
    p.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (r.method() === "GET" && path.startsWith("/api/v1/")) {
        counts.started++;
        if (path === "/api/v1/me/upcoming-event") counts.headerStarts++;
        if (path.startsWith("/api/v1/catalogs")) counts.catalogStarts++;
      }
    });
    p.on("response", (r) => {
      if (r.request().method() === "GET" && new URL(r.url()).pathname.startsWith("/api/v1/")) {
        counts.completed++;
        if (r.status() === 429) counts.limited++;
      }
    });
    p.on("requestfailed", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname.startsWith("/api/v1/")) counts.failed++;
    });
  }
  observe(page);
  async function actor(credentials?: { email: string; password: string }) {
    const context = await browser.newContext({
      ...device,
      baseURL: "http://127.0.0.1:4173",
      serviceWorkers: "block",
    });
    contexts.push(context);
    if (credentials)
      expect(
        (
          await write(context.request, "/auth/login", {
            email: credentials.email,
            password: credentials.password,
          })
        ).status(),
      ).toBe(200);
    else await context.addCookies((await staff.storageState()).cookies);
    const p = await context.newPage();
    observe(p);
    return p;
  }
  const availableEvents = fixture.composed.events;
  if (!availableEvents) throw Error("EVENT_BROWSER_SERVICE_MISSING");
  const events = availableEvents;
  async function event(
    visibility: "public" | "members" = "members",
    prescribed = false,
    started = false,
  ) {
    const input: components["schemas"]["EventInput"] = {
      title: `Fictional event ${randomUUID().slice(0, 8)}`,
      description: "Synthetic event fixture",
      game: "ets2",
      server: "Fictional Simulation",
      organizer: "Fictional Team",
      route: "Fictional North → Fictional South",
      meetingLocation: "Fictional harbour",
      meetingAt: new Date(Date.now() + 86400000 - 60000).toISOString(),
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: null,
      visibility,
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: prescribed ? (fixture.ids.fixture_crates as string) : null,
      prescribedMassKg: prescribed ? "21000" : null,
      prescribedTrailerTypeId: prescribed ? (fixture.ids.fixture_trailer as string) : null,
    };
    const created = await events.create(fixture.staff, randomUUID(), input),
      id = created.data.event.id;
    if (started) {
      await events.respond(fixture.author, id, randomUUID(), 1, { response: "participating" });
      await events.update(fixture.staff, id, randomUUID(), 1, {
        ...input,
        meetingAt: new Date(Date.now() - 120000).toISOString(),
        startsAt: new Date(Date.now() - 60000).toISOString(),
      });
    }
    return { id, input };
  }
  return {
    fixture,
    events,
    event,
    actor,
    counts,
    close: async () => {
      console.log(
        JSON.stringify({
          event: "event_browser_read_budget",
          scenario: name,
          project: info.project.name,
          ...counts,
        }),
      );
      await Promise.all(contexts.map((c) => c.close()));
      await staff.dispose();
      await fixture.close();
    },
  };
}
for (const visibility of ["public", "members"] as const) {
  test(`real staff creates ${visibility} event and anonymous public pages filter private data`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(60000);
    const s = await scenario(browser, page, info, `creation_${visibility}`);
    try {
      const manager = await s.actor(),
        created = await create(
          manager,
          `Fictional UI convoy ${randomUUID().slice(0, 8)}`,
          visibility,
          false,
          visibility === "public" ? s.fixture : undefined,
        );
      await expect(
        manager.getByText(
          visibility === "public" ? "Visibility: Public" : "Visibility: Members only",
          { exact: true },
        ),
      ).toBeVisible();
      const opposite = await s.event(visibility === "public" ? "members" : "public");
      const publicId = visibility === "public" ? created : opposite.id,
        privateId = visibility === "members" ? created : opposite.id;
      const pub = await page.request.get(`/api/v1/public/events/${publicId}`);
      expect(pub.status()).toBe(200);
      const data = (await pub.json()).data;
      for (const field of [
        "myResponse",
        "participants",
        "visibility",
        "prescribedCargoId",
        "declineReason",
        "attendance",
      ])
        expect(data).not.toHaveProperty(field);
      await page.goto(`/events/${publicId}`);
      await catalogLanguage(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await page.request.get(`/api/v1/public/events/${privateId}`)).status()).toBe(404);
      await page.goto(`/events/${privateId}`);
      await catalogLanguage(page);
      await expect(page.getByRole("alert")).toContainText("do not have access");
      await page.goto("/en");
      await expect(
        page.getByRole("heading", { name: "Public convoys", exact: true }),
      ).toBeVisible();
      const list = (await (await page.request.get("/api/v1/public/events?limit=100")).json()).data
        .items;
      expect(list.some((e: { id: string }) => e.id === privateId)).toBe(false);
    } finally {
      await s.close();
    }
  });
}
test("real voluntary RSVP changes preserve safe signed-up names and private decline reason", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const s = await scenario(browser, page, info, "rsvp");
  try {
    const e = await s.event(),
      member = await s.actor({ email: s.fixture.email, password: s.fixture.password });
    await member.goto(`/account/events/${e.id}`);
    await catalogLanguage(member);
    const response = member.getByRole("combobox", { name: "Your response", exact: true }),
      save = member.getByRole("button", { name: "Save response", exact: true });
    await response.selectOption("participating");
    await save.click();
    await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
    const other = await s.actor(await s.fixture.newMember());
    await other.goto(`/account/events/${e.id}`);
    await catalogLanguage(other);
    await expect(
      other.getByRole("link", { name: "Fictional Trip Browser Driver", exact: true }),
    ).toBeVisible();
    await response.selectOption("declined");
    const reason = member.getByLabel("Private decline reason", { exact: true });
    await reason.fill("   ");
    await save.click();
    await expect(member.getByRole("alert")).toContainText("Check");
    await reason.fill("Fictional private RSVP reason");
    await save.click();
    await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
    const safe = await other.request.get(`/api/v1/events/${e.id}`);
    expect(safe.status()).toBe(200);
    expect(JSON.stringify((await safe.json()).data)).not.toContain("Fictional private RSVP reason");
    expect((await other.request.get(`/api/v1/admin/events/${e.id}/attendance`)).status()).toBe(403);
    await expect(other.getByText("Fictional private RSVP reason", { exact: false })).toHaveCount(0);
    await response.selectOption("unanswered");
    await save.click();
    await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
  } finally {
    await s.close();
  }
});
test("real director and deputy privately inspect responses while dispatcher has no organizer access", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const s = await scenario(browser, page, info, "roles");
  try {
    const e = await s.event();
    await s.events.respond(s.fixture.author, e.id, randomUUID(), 1, {
      response: "declined",
      reason: "Fictional private manager reason",
    });
    const director = await s.actor(),
      deputy = await s.actor(await s.fixture.newMember(["driver", "deputy_director"])),
      dispatcher = await s.actor(await s.fixture.newMember(["driver", "dispatcher"]));
    for (const manager of [director, deputy]) {
      await manager.goto(`/account/events/${e.id}`);
      await catalogLanguage(manager);
      await manager
        .getByRole("button", { name: "View responses and attendance", exact: true })
        .click();
      const target = manager.locator(`#attendance-${s.fixture.userId}`);
      let pages = 0;
      while (true) {
        await expect(manager.locator(".event-attendance-row").first()).toBeVisible();
        if (await target.count()) break;
        expect(++pages).toBeLessThanOrEqual(10);
        const read = manager.waitForResponse(
          (r) =>
            r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/attendance"),
        );
        await manager.getByRole("button", { name: "Next page", exact: true }).click();
        await read;
      }
      await expect(
        manager.getByText("Fictional private manager reason", { exact: false }),
      ).toBeVisible();
    }
    await dispatcher.goto(`/account/events/${e.id}`);
    await catalogLanguage(dispatcher);
    await expect(dispatcher.getByRole("button", { name: "Edit event", exact: true })).toHaveCount(
      0,
    );
    await expect(
      dispatcher.getByRole("button", { name: "View responses and attendance", exact: true }),
    ).toHaveCount(0);
    expect((await dispatcher.request.get(`/api/v1/admin/events/${e.id}/attendance`)).status()).toBe(
      403,
    );
  } finally {
    await s.close();
  }
});
test("real reschedule preserves RSVP at revised cutoff and cancellation removes nearest event", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const s = await scenario(browser, page, info, "reschedule_cancel");
  try {
    const e = await s.event();
    await s.events.respond(s.fixture.author, e.id, randomUUID(), 1, { response: "participating" });
    const manager = await s.actor();
    await manager.goto(`/account/events/${e.id}`);
    await catalogLanguage(manager);
    await manager.getByRole("button", { name: "Edit event", exact: true }).click();
    const dialog = manager.getByRole("dialog");
    await dialog.getByLabel("Route", { exact: true }).fill("Fictional revised route");
    await dialog
      .getByLabel("Start time (UTC)", { exact: true })
      .fill(new Date(Date.now() + 172800000).toISOString().slice(0, 16));
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByText("Changes saved.", { exact: true })).toBeVisible();
    await manager.keyboard.press("Escape");
    const member = await s.actor({ email: s.fixture.email, password: s.fixture.password });
    await member.goto(`/account/events/${e.id}`);
    await catalogLanguage(member);
    await expect(member.getByRole("combobox", { name: "Your response", exact: true })).toHaveValue(
      "participating",
    );
    await member
      .getByRole("combobox", { name: "Your response", exact: true })
      .selectOption("unanswered");
    await member.getByRole("button", { name: "Save response", exact: true }).click();
    await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
    await manager.getByRole("button", { name: "Cancel event", exact: true }).click();
    await manager
      .getByRole("dialog")
      .getByLabel("Private reason", { exact: true })
      .fill("Fictional cancellation");
    await manager
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm cancellation", exact: true })
      .click();
    await expect(manager.getByText("Cancelled", { exact: true })).toBeVisible();
    const nearest = (await (await member.request.get("/api/v1/me/upcoming-event")).json()).data;
    expect(nearest?.id).not.toBe(e.id);
  } finally {
    await s.close();
  }
});
test("real staff attendance is distinct from RSVP and pins current prescribed-load proof", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const s = await scenario(browser, page, info, "attendance");
  try {
    const e = await s.event("members", true, true),
      before = await s.fixture.unit.run((tx) =>
        s.events.associateInTransaction(tx, s.fixture.author, {
          eventId: e.id,
          memberId: s.fixture.userId,
          game: "ets2",
        }),
      );
    expect(before.attendanceRevisionId).toBeNull();
    expect(before.confirmedEvent).toBeNull();
    const manager = await s.actor();
    await manager.goto(`/account/events/${e.id}`);
    await catalogLanguage(manager);
    await manager
      .getByRole("button", { name: "View responses and attendance", exact: true })
      .click();
    const control = manager.locator(`#attendance-${s.fixture.userId}`);
    let pages = 0;
    while (true) {
      await expect(manager.locator(".event-attendance-row").first()).toBeVisible();
      if (await control.count()) break;
      expect(++pages).toBeLessThanOrEqual(10);
      const read = manager.waitForResponse(
        (r) => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/attendance"),
      );
      await manager.getByRole("button", { name: "Next page", exact: true }).click();
      await read;
    }
    await control.selectOption("attended");
    await manager.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(manager.getByText("Attendance recorded.", { exact: true })).toBeVisible();
    const after = await s.fixture.unit.run((tx) =>
      s.events.associateInTransaction(tx, s.fixture.author, {
        eventId: e.id,
        memberId: s.fixture.userId,
        game: "ets2",
      }),
    );
    expect(after.attendanceRevisionId).not.toBeNull();
    expect(after.confirmedEvent).toMatchObject({
      prescribedMassKg: "21000",
      prescribedCargoId: s.fixture.ids.fixture_crates,
      prescribedTrailerTypeId: s.fixture.ids.fixture_trailer,
    });
  } finally {
    await s.close();
  }
});
test("real report event selector links current confirmed event while RSVP alone grants no exception", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const s = await scenario(browser, page, info, "report_link");
  try {
    const e = await s.event("members", true, true);
    await s.events.setAttendance(s.fixture.staff, e.id, randomUUID(), 1, {
      members: [{ memberId: s.fixture.userId, attendance: "attended", note: null }],
    });
    expect(
      (
        await write(page.request, "/auth/login", {
          email: s.fixture.email,
          password: s.fixture.password,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    const eventPage = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        new URL(r.url()).pathname === "/api/v1/events" &&
        new URL(r.url()).searchParams.get("period") === "past",
    );
    await page.getByRole("button", { name: "Past events", exact: true }).click();
    await eventPage;
    const select = page.locator("#report-event");
    let pages = 0;
    while (!(await select.locator(`option[value="${e.id}"]`).count())) {
      expect(++pages).toBeLessThanOrEqual(10);
      const read = page.waitForResponse(
        (r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/v1/events",
      );
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      await read;
    }
    await select.selectOption(e.id);
    const link = page.getByRole("link", { name: "View selected event", exact: true });
    await expect(link).toHaveAttribute("href", `/account/events/${e.id}`);
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(e.input.title);
    await expect(page.getByText(/An RSVP alone grants no exception/)).toBeVisible();
  } finally {
    await s.close();
  }
});
