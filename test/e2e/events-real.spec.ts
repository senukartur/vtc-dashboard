import { createHmac, randomUUID } from "node:crypto";
import type {
  Browser,
  BrowserContextOptions,
  Page,
  Request,
  Response,
  TestInfo,
} from "@playwright/test";
import type { components } from "@vtc/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { testConnection } from "../persistence/support.ts";
import { guardedAllocation } from "../support/environment.ts";
import {
  csrf,
  origin as legacyOrigin,
  resetAccountLimits,
  staffContext,
  write,
} from "./support/account.ts";
import { catalogLanguage, chooseCatalogRow } from "./support/catalogs.ts";
import { fillDateTime } from "./support/date-time.ts";
import { startStage2EventsServer } from "./support/events-stage-2-real.ts";
import { selectPastReportEvent } from "./support/events.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { createLandingCoverFixture } from "./support/landing-cover.ts";
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
  await fillDateTime(page, "Meeting time (UTC)", meeting);
  await fillDateTime(page, "Start time (UTC)", start);
  if (fixture) {
    await page.getByRole("button", { name: "Choose catalog selections", exact: true }).click();
    await chooseCatalogRow(page, "Prescribed cargo", "Fictional fixture_crates", "fixture_crates");
    await chooseCatalogRow(page, "Prescribed trailer type", "Fictional fixture_box", "fixture_box");
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
  const edit: {
    observed: boolean;
    outcome: "not-observed" | "pending" | "response" | "request-error";
    status: number | null;
    started: number;
    page: Page | null;
  } = { observed: false, outcome: "not-observed", status: null, started: 0, page: null };
  const editStops: (() => void)[] = [];
  function observe(p: Page) {
    if (name === "reschedule_cancel") {
      const definition = (request: Request) =>
        request.method() === "PATCH" &&
        /^\/api\/v1\/admin\/events\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname);
      const start = (request: Request) => {
        if (definition(request)) {
          edit.observed = true;
          edit.outcome = "pending";
          edit.status = null;
          edit.started = Date.now();
          edit.page = p;
        }
      };
      const response = (response: Response) => {
        if (definition(response.request())) {
          const status = response.status();
          edit.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
          edit.outcome = "response";
        }
      };
      const failure = (request: Request) => {
        if (definition(request)) edit.outcome = "request-error";
      };
      p.on("request", start);
      p.on("response", response);
      p.on("requestfailed", failure);
      editStops.push(() => {
        p.off("request", start);
        p.off("response", response);
        p.off("requestfailed", failure);
      });
    }
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
      prescribedTrailerTypeId: prescribed ? (fixture.ids.fixture_box as string) : null,
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
      for (const stop of editStops) stop();
      if (name === "reschedule_cancel") {
        const locale = await (edit.page ?? page)
          .locator("html")
          .getAttribute("lang", { timeout: 1000 })
          .catch(() => null);
        console.log(
          JSON.stringify({
            event: "event_definition_browser_command",
            phase: "definition-edit",
            observed: edit.observed,
            outcome: edit.outcome,
            status: edit.status,
            locale: locale === "en" || locale === "ru" ? locale : "other",
            elapsedMs: edit.observed ? Math.min(60000, Math.max(0, Date.now() - edit.started)) : 0,
          }),
        );
      }
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
  test(
    `real staff creates ${visibility} event and anonymous public pages filter private data`,
    browserCase(["@real"]),
    async ({ page, browser }, info) => {
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
          page.getByRole("heading", { name: "The convoy leaves on schedule", exact: true }),
        ).toBeVisible();
        const list = (await (await page.request.get("/api/v1/public/events?limit=100")).json()).data
          .items;
        expect(list.some((e: { id: string }) => e.id === privateId)).toBe(false);
      } finally {
        await s.close();
      }
    },
  );
}
test(
  "real voluntary RSVP changes preserve safe signed-up names and private decline reason",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
    test.setTimeout(60000);
    const s = await scenario(browser, page, info, "rsvp");
    try {
      const e = await s.event(),
        member = await s.actor({ email: s.fixture.email, password: s.fixture.password });
      await member.goto(`/account/events/${e.id}`);
      await catalogLanguage(member);
      const response = member.getByRole("group", { name: "Your response", exact: true }),
        choice = (name: string) => response.getByRole("button", { name, exact: true }),
        save = member.getByRole("button", { name: "Save response", exact: true });
      await choice("Participating").click();
      await expect(save).toHaveCount(0);
      await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
      const other = await s.actor(await s.fixture.newMember());
      await other.goto(`/account/events/${e.id}`);
      await catalogLanguage(other);
      const signedUp = other.getByRole("region", { name: "Signed up", exact: true }),
        cantAttend = other.getByRole("region", { name: "Can't attend", exact: true }),
        counts = other.getByRole("region", { name: "Participants", exact: true });
      await expect(
        signedUp.getByRole("link", { name: "Fictional Trip Browser Driver", exact: true }),
      ).toBeVisible();
      await expect(counts).toContainText("Participating: 1");
      await expect(counts).toContainText("Can't attend: 0");
      await choice("Can't attend").click();
      const reason = member.getByLabel("Private decline reason", { exact: true });
      await reason.fill("   ");
      await save.click();
      await expect(member.getByRole("alert")).toContainText("Check");
      await reason.fill("Fictional private RSVP reason");
      await save.click();
      await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
      const safe = await other.request.get(`/api/v1/events/${e.id}`);
      expect(safe.status()).toBe(200);
      expect(JSON.stringify((await safe.json()).data)).not.toContain(
        "Fictional private RSVP reason",
      );
      expect((await other.request.get(`/api/v1/admin/events/${e.id}/attendance`)).status()).toBe(
        403,
      );
      await other.reload();
      await catalogLanguage(other);
      await expect(
        cantAttend.getByRole("link", { name: "Fictional Trip Browser Driver", exact: true }),
      ).toBeVisible();
      await expect(
        signedUp.getByRole("link", { name: "Fictional Trip Browser Driver", exact: true }),
      ).toHaveCount(0);
      await expect(counts).toContainText("Participating: 0");
      await expect(counts).toContainText("Can't attend: 1");
      const decliners = await other.request.get(`/api/v1/events/${e.id}/decliners`);
      expect(decliners.status()).toBe(200);
      expect(await decliners.text()).not.toContain("Fictional private RSVP reason");
      await expect(other.getByText("Fictional private RSVP reason", { exact: false })).toHaveCount(
        0,
      );
      await choice("No answer").click();
      await expect(save).toHaveCount(0);
      await expect(member.getByText("Response saved.", { exact: true })).toBeVisible();
    } finally {
      await s.close();
    }
  },
);
test(
  "real director and deputy privately inspect responses while dispatcher has no organizer access",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
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
        const roster = manager.getByRole("form", { name: "Actual attendance", exact: true });
        const target = roster.locator(`#attendance-${s.fixture.userId}`);
        let pages = 0;
        while (true) {
          await expect(manager.locator(".event-attendance-row").first()).toBeVisible();
          if (await target.count()) break;
          expect(++pages).toBeLessThanOrEqual(10);
          const read = manager.waitForResponse(
            (r) =>
              r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/attendance"),
          );
          await roster.getByRole("button", { name: "Next page", exact: true }).click();
          await read;
        }
        await expect(
          manager.getByText("Fictional private manager reason", { exact: false }),
        ).toBeVisible();
      }
      await dispatcher.goto(`/account/events/${e.id}`);
      await catalogLanguage(dispatcher);
      await expect(
        dispatcher
          .getByRole("region", { name: "Can't attend", exact: true })
          .getByRole("link", { name: "Fictional Trip Browser Driver", exact: true }),
      ).toBeVisible();
      await expect(
        dispatcher.getByText("Fictional private manager reason", { exact: false }),
      ).toHaveCount(0);
      await expect(dispatcher.getByRole("button", { name: "Edit event", exact: true })).toHaveCount(
        0,
      );
      await expect(
        dispatcher.getByRole("button", { name: "View responses and attendance", exact: true }),
      ).toHaveCount(0);
      expect(
        (await dispatcher.request.get(`/api/v1/admin/events/${e.id}/attendance`)).status(),
      ).toBe(403);
    } finally {
      await s.close();
    }
  },
);
test(
  "real reschedule preserves RSVP at revised cutoff and cancellation removes nearest event",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
    test.setTimeout(60000);
    const s = await scenario(browser, page, info, "reschedule_cancel");
    try {
      const e = await s.event();
      await s.events.respond(s.fixture.author, e.id, randomUUID(), 1, {
        response: "participating",
      });
      const manager = await s.actor();
      await manager.goto(`/account/events/${e.id}`);
      await catalogLanguage(manager);
      await manager.getByRole("button", { name: "Edit event", exact: true }).click();
      const dialog = manager.getByRole("dialog");
      await dialog.getByLabel("Route", { exact: true }).fill("Fictional revised route");
      await fillDateTime(
        dialog,
        "Start time (UTC)",
        new Date(Date.now() + 172800000).toISOString().slice(0, 16),
      );
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(dialog.getByText("Changes saved.", { exact: true })).toBeVisible();
      await manager.keyboard.press("Escape");
      const member = await s.actor({ email: s.fixture.email, password: s.fixture.password });
      await member.goto(`/account/events/${e.id}`);
      await catalogLanguage(member);
      const response = member.getByRole("group", { name: "Your response", exact: true });
      await expect(
        response.getByRole("button", { name: "Participating", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await response.getByRole("button", { name: "No answer", exact: true }).click();
      await expect(member.getByRole("button", { name: "Save response", exact: true })).toHaveCount(
        0,
      );
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
  },
);
test(
  "real staff attendance is distinct from RSVP and pins current prescribed-load proof",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
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
          (r) =>
            r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/attendance"),
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
        prescribedTrailerTypeId: s.fixture.ids.fixture_box,
      });
    } finally {
      await s.close();
    }
  },
);
test(
  "real page two attendance lost receipt recovers one durable decision and its effects",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
    test.setTimeout(90000);
    const s = await scenario(browser, page, info, "attendance_receipt"),
      control = await testConnection();
    try {
      for (let i = 0; i < 26; i++) await s.fixture.newMember();
      const e = await s.event("members", true, true),
        first = await s.events.attendance(s.fixture.staff, e.id, { limit: 25 });
      expect(first.data.items).toHaveLength(25);
      expect(first.data.nextCursor).not.toBeNull();
      const second = await s.events.attendance(s.fixture.staff, e.id, {
          limit: 25,
          cursor: first.data.nextCursor as string,
        }),
        target = second.data.items[0];
      if (!target) throw Error("SYNTHETIC_SECOND_ATTENDANCE_PAGE_MISSING");
      async function counts() {
        const [rows] = await control.query<RowDataPacket[]>(
          `SELECT
        (SELECT COUNT(*) FROM event_attendance_revisions WHERE event_id=?) AS history,
        (SELECT COUNT(*) FROM event_commands WHERE target_id=? AND route='attendance') AS receipts,
        (SELECT COUNT(*) FROM audit_entries WHERE subject_kind='event' AND subject_id=?) AS audit,
        (SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=?) AS outbox,
        (SELECT trip_assessment_generation FROM events WHERE id=?) AS generation`,
          [e.id, e.id, e.id, e.id, e.id],
        );
        const row = rows[0];
        return Object.fromEntries(
          Object.entries(row as RowDataPacket).map(([k, v]) => [k, Number(v)]),
        );
      }
      const before = await counts(),
        manager = await s.actor(),
        attempts: { key: string; etag: string; body: unknown }[] = [];
      let loseReceipt = true;
      await manager.route(`**/api/v1/admin/events/${e.id}/attendance`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        attempts.push({
          key: route.request().headers()["idempotency-key"] as string,
          etag: route.request().headers()["if-match"] as string,
          body: route.request().postDataJSON(),
        });
        const response = await route.fetch({ timeout: 15000 });
        expect(response.status()).toBe(200);
        if (loseReceipt) {
          loseReceipt = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await manager.goto(`/account/events/${e.id}`);
      await catalogLanguage(manager);
      await manager
        .getByRole("button", { name: "View responses and attendance", exact: true })
        .click();
      await manager.getByRole("button", { name: "Next page", exact: true }).click();
      const select = manager.locator(`#attendance-${target.member.id}`);
      await select.selectOption("attended");
      await manager.locator(`#note-${target.member.id}`).fill("Fictional lost receipt proof");
      await manager.getByRole("button", { name: "Record attendance", exact: true }).click();
      await expect(manager.getByRole("alert")).toContainText("result is unknown");
      await expect(select).toHaveValue("attended");
      const committed = await counts();
      expect(committed).toEqual({
        history: 1,
        receipts: 1,
        audit: (before.audit as number) + 1,
        outbox: (before.outbox as number) + 1,
        generation: (before.generation as number) + 1,
      });
      await manager.getByRole("button", { name: "First page", exact: true }).click();
      await manager.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(select).toHaveValue("attended");
      await manager.getByRole("button", { name: "Record attendance", exact: true }).click();
      await expect(manager.getByText("Attendance recorded.", { exact: true })).toBeVisible();
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(attempts[0]?.etag).toBe('"v1"');
      expect(await counts()).toEqual(committed);
      expect((await s.events.history(s.fixture.staff, e.id)).attendance).toHaveLength(1);
    } finally {
      await control.end();
      await s.close();
    }
  },
);
test(
  "real report event selector links current confirmed event while RSVP alone grants no exception",
  browserCase(["@real"]),
  async ({ page, browser }, info) => {
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
      await selectPastReportEvent(page, e.id);
      const link = page.getByRole("link", { name: "View selected event", exact: true });
      await expect(link).toHaveAttribute("href", `/account/events/${e.id}`);
      await link.click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(e.input.title);
      await expect(page.getByText(/An RSVP alone grants no exception/)).toBeVisible();
    } finally {
      await s.close();
    }
  },
);

function stage2Journey(browser: Browser) {
  const servers: Awaited<ReturnType<typeof startStage2EventsServer>>[] = [];
  async function start(draftsEnabled: boolean) {
    const server = await startStage2EventsServer(draftsEnabled);
    servers.push(server);
    return server;
  }
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  let blocked = 0;

  async function commandHeaders(request: Page["request"], origin: string, etag?: string) {
    return {
      Origin: origin,
      "X-CSRF-Token": await csrf(request),
      "Idempotency-Key": randomUUID(),
      ...(etag ? { "If-Match": etag } : {}),
    };
  }

  async function post(
    request: Page["request"],
    path: string,
    data: unknown,
    origin: string,
    etag?: string,
  ) {
    return request.post(`/api/v1${path}`, {
      headers: await commandHeaders(request, origin, etag),
      data,
      maxRedirects: 0,
    });
  }

  async function cancel(request: Page["request"], origin: string, id: string) {
    const current = await request.get(`/api/v1/events/${id}?locale=en`);
    expect(current.status()).toBe(200);
    const { data } = (await current.json()) as components["schemas"]["EventStage2EnvelopeMember"];
    if (data.event.status !== "scheduled") return;
    const etag = current.headers().etag;
    if (!etag) throw new Error("STAGE_2_EVENT_CLEANUP_VERSION_MISSING");
    const cancelled = await post(
      request,
      `/admin/events/${id}/cancellation?locale=en`,
      { reason: "Synthetic browser fixture cleanup" },
      origin,
      etag,
    );
    expect(cancelled.status()).toBe(200);
  }

  async function discard(request: Page["request"], origin: string, id: string) {
    const current = await request.get(`/api/v1/admin/events/drafts/${id}`);
    expect(current.status()).toBe(200);
    const etag = current.headers().etag;
    if (!etag) throw new Error("STAGE_2_DRAFT_CLEANUP_VERSION_MISSING");
    const discarded = await request.delete(`/api/v1/admin/events/${id}`, {
      headers: await commandHeaders(request, origin, etag),
      maxRedirects: 0,
    });
    expect(discarded.status()).toBe(200);
  }

  async function actor(email: string, credentialKey: string, origin: string) {
    const context = await browser.newContext({
      baseURL: origin,
      locale: "en-GB",
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    contexts.push(context);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.username && !url.password) return route.continue();
      blocked++;
      return route.abort("blockedbyclient");
    });
    const password = createHmac("sha256", guardedAllocation().token)
      .update(credentialKey)
      .digest("base64url");
    const login = await post(context.request, "/auth/login", { email, password }, origin);
    expect(login.status()).toBe(200);
    return context.newPage();
  }

  async function close() {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await Promise.all(servers.map((server) => server.close()));
    }
  }

  return { start, post, actor, cancel, discard, close, blockedRequests: () => blocked };
}

async function openEventsAs(
  page: Page,
  origin: string,
  path: string,
  stage2: boolean,
  drafts: boolean,
  capability: "events.manage" | "events.respond",
) {
  const browserSession = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/me",
  );
  await page.goto(path);
  expect(new URL(page.url()).origin).toBe(origin);
  const response = await browserSession;
  expect(new URL(response.url()).origin).toBe(origin);
  expect(response.status(), "browser session status").toBe(200);
  expect(response.headers()["x-vtc-events-stage2"]).toBe(stage2 ? "1" : undefined);
  expect(response.headers()["x-vtc-events-drafts"]).toBe(drafts ? "1" : undefined);
  const { capabilities, member } = (
    (await response.json()) as components["schemas"]["EnvelopeSelf"]
  ).data;
  expect(capabilities.includes("company.read")).toBe(true);
  expect(capabilities.includes(capability)).toBe(true);
  await catalogLanguage(page);
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Company events", exact: true }),
  ).toBeVisible();
  return member.id;
}

test(
  "real Stage 2 cards persist quick RSVP and pick up the event detail revision",
  browserCase(["@real"]),
  async ({ browser, page }, info) => {
    test.setTimeout(60000);
    type DTO = components["schemas"];
    const journey = stage2Journey(browser);
    const { actor, post } = journey;
    let cleanup = async () => {};
    let legacy: Awaited<ReturnType<typeof staffContext>> | undefined;

    try {
      const server = await journey.start(false);
      const manager = await actor(
        "browser@example.invalid",
        "browser-identity-password",
        server.origin,
      );
      const project = info.project.name.split("-")[0];
      const member = await actor(
        `browser-steam-${project}@example.invalid`,
        `browser-steam-${project}`,
        server.origin,
      );
      const managerSelf = await manager.request.get("/api/v1/me");
      expect(managerSelf.status()).toBe(200);
      const organizer = ((await managerSelf.json()) as DTO["EnvelopeSelf"]).data.member.id;
      const suffix = randomUUID().slice(0, 8);
      const title = `Fictional Stage 2 convoy ${suffix}`;
      const start = Date.now() + 1800000;
      const published = await post(
        manager.request,
        "/admin/events?locale=en",
        {
          title,
          description: "Synthetic Stage 2 event",
          game: "ets2",
          platform: "truckersmp",
          server: "Fictional Simulation",
          organizerMemberId: organizer,
          route: "Fictional North to Fictional South",
          meetingLocation: "Fictional harbour",
          meetingAt: new Date(start - 60000).toISOString(),
          startsAt: new Date(start).toISOString(),
          endsAt: null,
          visibility: "members",
          originCityId: null,
          destinationCityId: null,
          prescribedCargoId: null,
          prescribedMassKg: null,
          prescribedTrailerTypeId: null,
          requiredDlcIds: [],
        } satisfies DTO["EventStage2PublishedCreationInput"],
        server.origin,
      );
      expect(published.status()).toBe(201);
      const created = ((await published.json()) as DTO["EventStage2EnvelopeCreation"]).data;
      if (!("event" in created)) throw new Error("STAGE_2_PUBLISHED_EVENT_MISSING");
      const eventId = created.event.id;
      cleanup = () => journey.cancel(manager.request, server.origin, eventId);

      const publishedOnly = manager;
      let draftReads = 0;
      publishedOnly.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname.startsWith("/api/v1/admin/events")
        )
          draftReads++;
      });
      const publishedOnlyList = publishedOnly.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/v1/events",
      );
      await openEventsAs(
        publishedOnly,
        server.origin,
        "/account/events?period=drafts&cursor=fictional-draft-cursor",
        true,
        false,
        "events.manage",
      );
      const fallbackList = await publishedOnlyList;
      expect(fallbackList.status()).toBe(200);
      const fallbackSearch = new URL(fallbackList.url()).searchParams;
      expect(fallbackSearch.has("locale")).toBe(true);
      expect(fallbackSearch.get("period")).toBe("upcoming");
      expect(fallbackSearch.has("cursor")).toBe(false);
      await expect(
        publishedOnly.getByRole("main").getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
      await expect(publishedOnly.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(
        0,
      );
      await expect(
        publishedOnly.getByRole("link", { name: "Create event", exact: true }),
      ).toBeVisible();
      expect(draftReads).toBe(0);

      legacy = await staffContext();
      await page.context().addCookies((await legacy.storageState()).cookies);
      const legacyRead = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/v1/events",
      );
      await openEventsAs(
        page,
        legacyOrigin,
        "/account/events?period=drafts&cursor=fictional-draft-cursor",
        false,
        false,
        "events.manage",
      );
      const legacyList = await legacyRead;
      expect(legacyList.status()).toBe(200);
      const legacySearch = new URL(legacyList.url()).searchParams;
      expect(legacySearch.has("locale")).toBe(false);
      expect(legacySearch.get("period")).toBe("upcoming");
      expect(legacySearch.has("cursor")).toBe(false);
      await expect(
        page.getByRole("main").getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);

      let ownReads = 0;
      const responsePath = `/api/v1/events/${eventId}/my-response`;
      member.on("request", (request) => {
        if (request.method() === "GET" && new URL(request.url()).pathname === responsePath)
          ownReads++;
      });
      const firstList = member.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/v1/events" &&
          url.searchParams.get("locale") === "en"
        );
      });
      const memberId = await openEventsAs(
        member,
        server.origin,
        "/account/events",
        true,
        false,
        "events.respond",
      );
      expect((await firstList).status()).toBe(200);
      const memberMain = member.getByRole("main");
      const card = memberMain.getByRole("listitem").filter({
        has: member.getByRole("link", { name: title, exact: true }),
      });
      await expect(card).toContainText("TruckersMP");
      await expect(card).toContainText("No DLC required");
      await expect(card).toContainText("Participating: 0");
      await expect(memberMain.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);

      const responseWritten = () =>
        member.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === responsePath,
        );
      const going = responseWritten();
      await card.getByRole("button", { name: "Going", exact: true }).click();
      const goingResult = await going;
      expect(goingResult.status()).toBe(200);
      expect(goingResult.request().headers()["if-match"]).toBe('"v1"');
      const goingEtag = goingResult.headers().etag;
      expect(goingEtag).toMatch(/^"v[1-9][0-9]*"$/);
      await expect(card.getByText("Response saved.", { exact: true })).toBeVisible();
      await expect(card).toContainText("Participating: 1");

      await card.getByRole("button", { name: "Can't go", exact: true }).click();
      await card
        .getByLabel("Private decline reason", { exact: true })
        .fill("Fictional schedule conflict");
      const decline = responseWritten();
      await card.getByRole("button", { name: "Save response", exact: true }).click();
      const declineResult = await decline;
      expect(declineResult.status()).toBe(200);
      expect(declineResult.request().headers()["if-match"]).toBe(goingEtag);
      await expect(card.getByText("Response saved.", { exact: true })).toBeVisible();
      await member.reload();
      await expect(card).toContainText("Participating: 0");
      await expect(card).toContainText("Can't attend: 1");
      await expect(card).toContainText("Your response: Can't attend");
      expect(ownReads).toBe(0);

      const header = member.locator(".event-nearest");
      await expect(header.getByRole("link", { name: new RegExp(title) })).toBeVisible();
      const headerGoing = header.getByRole("button", { name: "Going", exact: true });
      await card.getByRole("link", { name: title, exact: true }).click();
      await expect(memberMain.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const detailResponse = memberMain.getByRole("group", { name: "Your response", exact: true });
      const reset = responseWritten();
      await detailResponse.getByRole("button", { name: "No answer", exact: true }).click();
      const resetResult = await reset;
      expect(resetResult.status()).toBe(200);
      expect(resetResult.request().headers()["if-match"]).toBe(declineResult.headers().etag);
      const resetEtag = resetResult.headers().etag;
      expect(resetEtag).toMatch(/^"v[1-9][0-9]*"$/);
      await expect(memberMain.getByText("Response saved.", { exact: true })).toBeVisible();
      const detailOwnReads = ownReads;
      const participants = memberMain.getByRole("region", { name: "Participants", exact: true });
      const signedUp = participants.getByRole("region", { name: "Signed up", exact: true });
      const selfLink = signedUp.locator(`a[href="/account/drivers/${memberId}"]`);
      await expect(participants).toContainText("Participating: 0");
      await expect(selfLink).toHaveCount(0);
      const fromHeader = responseWritten();
      await headerGoing.click();
      const headerResult = await fromHeader;
      expect(headerResult.status()).toBe(200);
      expect(headerResult.request().headers()["if-match"]).toBe(resetEtag);
      await expect(headerGoing).toHaveAttribute("aria-pressed", "true");
      await expect(participants).toContainText("Participating: 1");
      await expect(selfLink).toBeVisible();
      expect(ownReads).toBe(detailOwnReads);

      expect(journey.blockedRequests()).toBe(0);
    } finally {
      try {
        await cleanup();
      } finally {
        try {
          await legacy?.dispose();
        } finally {
          await journey.close();
        }
      }
    }
  },
);

test(
  "real Stage 2 Continue opens and saves the same draft across reload",
  browserCase(["@real"]),
  async ({ browser }, info) => {
    test.setTimeout(60000);
    type DTO = components["schemas"];
    const journey = stage2Journey(browser);
    const { actor, post } = journey;
    let cleanup = async () => {};

    try {
      const server = await journey.start(true);
      const manager = await actor(
        "browser@example.invalid",
        "browser-identity-password",
        server.origin,
      );
      const project = info.project.name.split("-")[0];
      const member = await actor(
        `browser-steam-${project}@example.invalid`,
        `browser-steam-${project}`,
        server.origin,
      );
      const draftTitle = `Fictional saved draft ${randomUUID().slice(0, 8)}`;
      const draftDescription = "Synthetic saved description for direct draft entry.";
      const saved = await post(
        manager.request,
        "/admin/events?locale=en",
        {
          draft: true,
          title: draftTitle,
          description: draftDescription,
        } satisfies DTO["EventStage2DraftCreationInput"],
        server.origin,
      );
      expect(saved.status()).toBe(201);
      const draft = ((await saved.json()) as DTO["EventStage2EnvelopeCreation"]).data;
      if (!("lifecycle" in draft) || draft.lifecycle !== "draft")
        throw new Error("STAGE_2_SAVED_DRAFT_MISSING");
      cleanup = () => journey.discard(manager.request, server.origin, draft.id);
      const draftPath = `/api/v1/admin/events/drafts/${draft.id}`;
      expect((await member.request.get(draftPath)).status()).toBe(403);

      await openEventsAs(manager, server.origin, "/account/events", true, true, "events.manage");
      const managerMain = manager.getByRole("main");
      const period = managerMain.getByRole("group", { name: "Period", exact: true });
      const drafts = period.getByRole("button", { name: "Drafts", exact: true });
      await expect(drafts).toBeVisible();
      const draftList = manager.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/v1/admin/events" &&
          url.searchParams.get("period") === "drafts"
        );
      });
      await drafts.click();
      expect((await draftList).status()).toBe(200);
      await expect(drafts).toHaveAttribute("aria-pressed", "true");
      const draftRow = managerMain.getByRole("listitem").filter({
        has: manager.getByRole("heading", { name: draftTitle, exact: true }),
      });
      const draftRead = () =>
        manager.waitForResponse(
          (response) =>
            response.request().method() === "GET" && new URL(response.url()).pathname === draftPath,
        );
      const resumedUrl = `${server.origin}/account/events/new?draftId=${draft.id}`;
      const continued = draftRead();
      await draftRow.getByRole("link", { name: "Continue", exact: true }).click();
      const basics = managerMain.getByRole("group", { name: "Basics", exact: true });
      const title = basics.getByRole("textbox", { name: "Event title", exact: true });
      const description = basics.getByRole("textbox", {
        name: "Description · Optional",
        exact: true,
      });
      const assertSavedDraft = async (expectedDescription: string) => {
        await expect(manager).toHaveURL(resumedUrl);
        await expect(
          manager.getByRole("heading", { name: "Edit event draft", exact: true }),
        ).toBeVisible();
        await expect(title).toHaveValue(draftTitle);
        await expect(description).toHaveValue(expectedDescription);
      };
      const continuedDraft = await continued;
      expect(continuedDraft.status()).toBe(200);
      const draftEtag = continuedDraft.headers().etag;
      expect(draftEtag).toMatch(/^"v[1-9][0-9]*"$/);
      await assertSavedDraft(draftDescription);
      const revisedDescription = "Synthetic description revised in the saved draft editor.";
      await description.fill(revisedDescription);
      const savedRevision = manager.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === draftPath,
      );
      await manager.getByRole("button", { name: "Save draft", exact: true }).click();
      const patched = await savedRevision;
      expect(patched.status()).toBe(200);
      expect(patched.request().headers()["if-match"]).toBe(draftEtag);
      const patchedEtag = patched.headers().etag;
      expect(patchedEtag).toMatch(/^"v[1-9][0-9]*"$/);
      expect(patchedEtag).not.toBe(draftEtag);
      const revisedDraft = ((await patched.json()) as DTO["EventStage2EnvelopeDraft"]).data;
      expect(revisedDraft.id).toBe(draft.id);
      expect(revisedDraft.fields.description).toBe(revisedDescription);
      await expect(manager.getByText("Draft saved.", { exact: true })).toBeVisible();
      const reopened = draftRead();
      await manager.reload();
      const reopenedDraft = await reopened;
      expect(reopenedDraft.status()).toBe(200);
      expect(reopenedDraft.headers().etag).toBe(patchedEtag);
      await assertSavedDraft(revisedDescription);
      expect(journey.blockedRequests()).toBe(0);
    } finally {
      try {
        await cleanup();
      } finally {
        await journey.close();
      }
    }
  },
);

test(
  "real public landing shows the selected ready cover, then its replacement and removal",
  browserCase(["@real"]),
  async ({ browser }) => {
    test.setTimeout(60000);
    await using event = await createLandingCoverFixture();
    const context = await browser.newContext({
      baseURL: event.origin,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    try {
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === event.origin
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      await context.addCookies([
        { name: "vtc_fictional_probe", value: "fictional", url: event.origin },
      ]);
      const visitor = await context.newPage();
      const card = visitor.getByRole("article").filter({
        has: visitor.getByRole("heading", { name: event.title, exact: true }),
      });
      const image = card.getByRole("img", { name: event.title, exact: true });
      async function showLanding(hasCover: boolean, locale: "ru" | "en") {
        const list = visitor.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname === "/api/v1/public/events" &&
            url.searchParams.get("period") === "upcoming" &&
            url.searchParams.get("limit") === "3" &&
            url.searchParams.get("locale") === locale
          );
        });
        await visitor.goto(locale === "en" ? "/en" : "/");
        const response = await list;
        expect(response.status()).toBe(200);
        const { data } =
          (await response.json()) as components["schemas"]["EventStage2EnvelopePublicList"];
        expect(data.items.find((item) => item.id === event.id)?.hasCover).toBe(hasCover);
        await expect(card.getByRole("link", { name: event.title, exact: true })).toBeVisible();
        await expect(card).toContainText(event.route[locale]);
      }
      async function showCover(width: number, locale: "ru" | "en") {
        const pending = visitor.waitForResponse((response) =>
          response.url().endsWith(event.coverPath),
        );
        await showLanding(true, locale);
        await card.scrollIntoViewIfNeeded();
        const response = await pending;
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toBe("image/jpeg");
        expect(response.headers()["cache-control"]).toBe("no-store");
        expect(response.headers()["x-content-type-options"]).toBe("nosniff");
        expect((await response.request().allHeaders()).cookie).toBeUndefined();
        await expect(image).toBeVisible();
        // Read the bytes backing the displayed image without another HTTP request.
        const displayed = await image.evaluate(async (node: HTMLImageElement) => {
          if (!node.currentSrc.startsWith("blob:")) throw new Error("COVER_BLOB_REQUIRED");
          const blob = await fetch(node.currentSrc);
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
          return {
            signature: Array.from(bytes.subarray(0, 2)),
            digest: Array.from(digest),
            width: node.naturalWidth,
          };
        });
        expect(displayed.signature).toEqual([0xff, 0xd8]);
        expect(displayed.width).toBe(width);
        return displayed.digest;
      }

      await showLanding(false, "en");
      await expect(image).toHaveCount(0);
      expect((await visitor.request.get(event.coverPath)).status()).toBe(404);
      const first = await event.upload(120);
      await event.select(first);
      const firstDigest = await showCover(120, "en");
      const replacement = await event.upload(160);
      await event.select(replacement);
      const replacementDigest = await showCover(160, "en");
      expect(replacementDigest).not.toEqual(firstDigest);
      await showCover(160, "ru");
      await event.remove(replacement);
      await showLanding(false, "en");
      await expect(image).toHaveCount(0);
      expect((await visitor.request.get(event.coverPath)).status()).toBe(404);
    } finally {
      await context.close();
    }
  },
);
