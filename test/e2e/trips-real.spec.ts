import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { and, eq, isNull, trips as tripRows } from "@vtc/db/trips-schema";
import { pngBytes } from "../fixtures/manual-images.ts";
import { resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { tripBrowserFixture } from "./support/trips.ts";

test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
async function confirm(page: Page, label: string, commandPath?: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = commandPath
    ? page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === commandPath,
        { timeout: 15000 },
      )
    : null;
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  if (response) expect((await response).status()).toBe(201);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function fill(
  page: Page,
  fixture: Awaited<ReturnType<typeof tripBrowserFixture>>,
  unresolved = false,
) {
  await page
    .getByRole("combobox", { name: "Origin city", exact: true })
    .selectOption(fixture.ids.fixture_north as string);
  await page
    .getByRole("combobox", { name: "Destination city", exact: true })
    .selectOption(fixture.ids.fixture_south as string);
  await page
    .getByRole("combobox", { name: "Trailer type", exact: true })
    .selectOption(fixture.ids.fixture_trailer as string);
  if (unresolved) {
    const cargo = page.getByRole("group", { name: "Cargo", exact: true });
    await cargo.getByRole("checkbox").check();
    await cargo.getByLabel("Diagnostic label", { exact: true }).fill("Fictional unmapped cargo");
  } else
    await page
      .getByRole("combobox", { name: "Cargo", exact: true })
      .selectOption(fixture.ids.fixture_crates as string);
  await page.getByLabel("Cargo mass (kg)", { exact: true }).fill("18000");
  await page.getByLabel("Actual driven distance (m)", { exact: true }).fill("123400");
  await page
    .getByLabel("Choose completion screenshot", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
  const requests: { method: string; category: string }[] = [];
  const record = (request: import("@playwright/test").Request) => {
    const p = new URL(request.url()).pathname;
    if (p.startsWith("/api/v1/"))
      requests.push({
        method: request.method(),
        category:
          p === "/api/v1/auth/csrf"
            ? "csrf"
            : p.startsWith("/api/v1/evidence")
              ? "evidence"
              : "other",
      });
  };
  page.on("request", record);
  await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
  await expect(page.getByText("Ready · image/png", { exact: false })).toBeVisible();
  await page.waitForTimeout(250);
  page.off("request", record);
  console.log(
    JSON.stringify({
      event: "trip_browser_measurement",
      action: "real_upload",
      reads: requests.filter((r) => r.method === "GET").length,
      writes: requests.filter((r) => r.method === "POST").length,
      unrelatedReads: requests.filter((r) => r.method === "GET" && r.category === "other").length,
    }),
  );
  expect(requests.filter((r) => r.method === "GET" && r.category === "other")).toHaveLength(0);
}
async function proposal(staff: Awaited<ReturnType<typeof staffContext>>, tripId: string) {
  const response = await staff.get(`/api/v1/trips/${tripId}/proposals?limit=25`);
  expect(response.status()).toBe(200);
  return (await response.json()).data.items.find(
    (p: { state: string; kind: string }) => p.state === "pending" && p.kind === "resolution",
  );
}
async function approve(
  page: Page,
  staff: Awaited<ReturnType<typeof staffContext>>,
  tripId: string,
) {
  const p = await proposal(staff, tripId);
  if (!p) throw Error("SYNTHETIC_PROPOSAL_MISSING");
  await page.locator("summary").filter({ hasText: p.id }).click();
  await page.locator(`#proposal-${p.id}`).fill("Fictional verified proposal");
  await confirm(page, "Approve proposal");
}
test("real report draft upload unresolved cargo stale review rejection revision acceptance correction attachment and reversible reconciliation", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await resetAccountLimits();
  const fixture = await tripBrowserFixture(),
    staff = await staffContext(),
    staffContextBrowser = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
      viewport: page.viewportSize(),
      serviceWorkers: "block",
    });
  let phase = "START";
  try {
    await staffContextBrowser.addCookies((await staff.storageState()).cookies);
    const staffPage = await staffContextBrowser.newPage();
    const login = await write(page.request, "/auth/login", {
      email: fixture.email,
      password: fixture.password,
    });
    expect(login.status()).toBe(200);
    phase = "DRAFT";
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await page
      .getByLabel("Comment (optional)", { exact: true })
      .fill("Fictional durable partial draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/reports\/drafts\//);
    await page.reload();
    await catalogLanguage(page);
    await expect(page.getByLabel("Comment (optional)", { exact: true })).toHaveValue(
      "Fictional durable partial draft",
    );
    await resetAccountLimits();
    phase = "UPLOAD_SUBMIT";
    await fill(page, fixture, true);
    await expect(page.locator('input[type="date"],input[type="datetime-local"]')).toHaveCount(0);
    await confirm(page, "Submit for review");
    await expect(page).toHaveURL(/\/account\/trips\//);
    const tripId = new URL(page.url()).pathname.split("/").at(-1) as string;
    let current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
    expect(current.summary.decision).toBe("pending_review");
    const reportId = current.manualRevision.reportId,
      evidenceIds = current.manualRevision.fields.evidenceIds;
    expect((await fixture.composed.trips?.status(fixture.author))?.counts.accepted).toBe(0);
    await staffPage.goto(`/account/review/${tripId}`);
    await catalogLanguage(staffPage);
    await resetAccountLimits();
    phase = "STALE_DECISION";
    await staffPage.locator("#review-reason").fill("Fictional rejection after current review");
    await staffPage.getByRole("button", { name: "Reject trip", exact: true }).click();
    await page.goto(`/account/reports/${reportId}/edit`);
    await catalogLanguage(page);
    await page
      .getByLabel("Comment (optional)", { exact: true })
      .fill("Fictional edit after staff opened review");
    await confirm(page, "Revise and resubmit");
    await staffPage
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(staffPage.getByRole("dialog")).toHaveCount(0);
    await expect(staffPage.getByRole("alert").filter({ hasText: "record changed" })).toBeVisible();
    await expect(staffPage.locator("#review-reason")).toHaveValue(
      "Fictional rejection after current review",
    );
    await confirm(staffPage, "Reject trip");
    await resetAccountLimits();
    phase = "RESUBMIT_ACCEPT";
    await page.goto(`/account/reports/${reportId}/edit`);
    await catalogLanguage(page);
    await page
      .getByLabel("Comment (optional)", { exact: true })
      .fill("Fictional revised rejected report");
    await confirm(page, "Revise and resubmit");
    await staffPage.reload();
    await catalogLanguage(staffPage);
    await resetAccountLimits();
    phase = "STAFF_RESOLUTION";
    await staffPage.getByText("Propose supported resolution", { exact: true }).click();
    await staffPage
      .getByRole("combobox", { name: "Cargo", exact: true })
      .selectOption(fixture.ids.fixture_crates as string);
    await staffPage.locator("#resolution-reason").fill("Fictional cargo confirmed from screenshot");
    await confirm(staffPage, "Propose supported resolution");
    await approve(staffPage, staff, tripId);
    current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
    expect(current.summary.decision).toBe("accepted");
    expect(current.decisions.some((d: { outcome: string }) => d.outcome === "rejected")).toBe(true);
    await resetAccountLimits();
    phase = "CORRECTION";
    await page.reload();
    await catalogLanguage(page);
    await page.locator("#correction-reason").fill("Fictional distance needs correction");
    const correctionPath = `/api/v1/trips/${tripId}/correction-requests`;
    let releaseReceipt = () => {},
      receiptHeld = false;
    const receiptGate = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const holdReceipt: Parameters<Page["route"]>[1] = async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      receiptHeld = true;
      await receiptGate;
      await route.fulfill({ response });
    };
    await page.route(`**${correctionPath}`, holdReceipt);
    const correction = confirm(page, "Request correction", correctionPath);
    void correction.catch(() => {});
    try {
      await expect.poll(() => receiptHeld, { timeout: 15000 }).toBe(true);
      // Inject receipt latency beyond the old UI matcher while staying inside the command deadline.
      await page.waitForTimeout(5500);
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Loading…", exact: true }),
      ).toBeDisabled();
      releaseReceipt();
      await correction;
    } finally {
      releaseReceipt();
      await correction.catch(() => {});
      await page.unroute(`**${correctionPath}`, holdReceipt);
    }
    current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
    expect(current.summary.actualDistanceM).toBe("123400");
    const requests = (
      await (await page.request.get(`/api/v1/trips/${tripId}/correction-requests?limit=25`)).json()
    ).data.items;
    expect(requests.filter((r: { status: string }) => r.status === "pending")).toHaveLength(1);
    const requestId = requests.find((r: { status: string }) => r.status === "pending").id;
    await staffPage.reload();
    await catalogLanguage(staffPage);
    await staffPage.getByText("Propose supported resolution", { exact: true }).click();
    await staffPage.locator("#resolution-request").selectOption(requestId);
    await staffPage.locator("#resolution-actualDistanceM").fill("123000");
    await staffPage.locator("#resolution-reason").fill("Fictional verified distance correction");
    await confirm(staffPage, "Propose supported resolution");
    await approve(staffPage, staff, tripId);
    current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
    expect(current.summary.actualDistanceM).toBe("123000");
    expect(current.summary.reportingBasis).toBe("manual_confirmation");
    expect(current.effectiveFacts.plannedDistanceM).toBeNull();
    await resetAccountLimits();
    phase = "TELEMETRY_ATTACHMENT";
    const telemetry = await fixture.telemetry(undefined, "started");
    const countCanonical = () =>
      fixture.unit.run(
        async (tx) =>
          (
            await fixture.unit
              .client(tx)
              .select({ id: tripRows.id })
              .from(tripRows)
              .where(and(eq(tripRows.ownerId, fixture.userId), isNull(tripRows.aliasOf)))
          ).length,
      );
    const beforeAttachment = await countCanonical();
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await fill(page, fixture);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/reports\/drafts\//);
    await page.reload();
    await catalogLanguage(page);
    await page.locator("#manual-target").selectOption(telemetry.tripId);
    await expect(
      page.getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeEnabled();
    const attempt = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/submission") &&
        response.request().method() === "POST",
    );
    await confirm(page, "Submit for review");
    const submitted = await attempt;
    if (submitted.status() === 409) {
      await expect(page.getByRole("alert").filter({ hasText: "record changed" })).toBeVisible();
      await page.getByRole("button", { name: "Reload telemetry targets", exact: true }).click();
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Submit for review", exact: true }),
      ).toBeEnabled();
      const retry = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/submission") &&
          response.request().method() === "POST",
      );
      await confirm(page, "Submit for review");
      const committed = await retry;
      expect(committed.status()).toBe(201);
      expect(committed.request().headers()["idempotency-key"]).not.toBe(
        submitted.request().headers()["idempotency-key"],
      );
    } else expect(submitted.status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/account/trips/${telemetry.tripId}$`));
    current = (await (await page.request.get(`/api/v1/trips/${telemetry.tripId}`)).json()).data;
    expect(current.summary.sourceKinds.sort()).toEqual(["ets2telemetry", "manual"]);
    expect(await countCanonical()).toBe(beforeAttachment);
    await resetAccountLimits();
    phase = "DUPLICATE_MERGE";
    const source = await fixture.telemetry();
    const manual = fixture.composed.manualReports;
    if (!manual) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
    const duplicate = await manual.submitReport(fixture.author, randomUUID(), {
      fields: { ...fixture.fields, evidenceIds },
    });
    await expect
      .poll(
        async () => {
          const r = await staff.get("/api/v1/reconciliation-candidates?limit=100");
          return (await r.json()).data.items.some(
            (c: { primaryTripId: string; secondaryTripId: string }) =>
              [c.primaryTripId, c.secondaryTripId].includes(source.tripId) &&
              [c.primaryTripId, c.secondaryTripId].includes(duplicate.tripId),
          );
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await staffPage.goto("/account/review/reconciliation");
    await catalogLanguage(staffPage);
    const candidate = staffPage
      .locator("article")
      .filter({ hasText: source.tripId })
      .filter({ hasText: duplicate.tripId });
    await candidate.getByRole("button", { name: "Review candidate", exact: true }).click();
    await staffPage.locator("#merge-primary").selectOption(source.tripId);
    await staffPage.locator("#merge-reason").fill("Fictional duplicate source review");
    await confirm(staffPage, "Merge trips");
    const history = (
      await (await staff.get(`/api/v1/trips/${source.tripId}/reconciliations?limit=25`)).json()
    ).data.items;
    expect(history.length).toBeGreaterThan(0);
    const merged = history[0];
    await resetAccountLimits();
    phase = "RELOAD_REVERSE";
    await staffPage.goto(`/account/trips/${merged.primaryTripId}`);
    await catalogLanguage(staffPage);
    await staffPage.getByText("Reconciliation history", { exact: true }).click();
    await staffPage.locator("summary").filter({ hasText: merged.id }).click();
    await staffPage
      .locator(`#reverse-${merged.id}`)
      .fill("Fictional independent journeys restored");
    await confirm(staffPage, "Reverse merge");
    expect(
      (await (await staff.get(`/api/v1/reconciliations/${merged.id}`)).json()).data.state,
    ).toBe("reversed");
    await resetAccountLimits();
    phase = "PRIVACY";
    const ordinary = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
      serviceWorkers: "block",
    });
    try {
      const visitor = await ordinary.newPage();
      const another = await fixture.newMember();
      await write(visitor.request, "/auth/login", {
        email: another.email,
        password: another.password,
      });
      await visitor.goto(`/account/trips/${tripId}`);
      await catalogLanguage(visitor);
      await expect(visitor.getByText("Accepted company summary", { exact: true })).toBeVisible();
      expect((await visitor.request.get(`/api/v1/evidence/${evidenceIds[0]}`)).status()).toBe(404);
      expect(
        (await visitor.request.get(`/api/v1/trips/${tripId}/manual-revisions?limit=25`)).status(),
      ).toBe(404);
      await expect(visitor.locator("body")).not.toContainText(
        "Fictional distance needs correction",
      );
    } finally {
      await ordinary.close();
    }
  } catch (error) {
    throw new Error(`SYNTHETIC_TRIP_BROWSER_${phase}`, { cause: error });
  } finally {
    await staffContextBrowser.close();
    await staff.dispose();
    await fixture.close();
  }
});

test("real owner event association requires confirmed attendance and late telemetry preserves the confirmed result until staff review", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await resetAccountLimits();
  const fixture = await tripBrowserFixture(),
    staff = await staffContext(),
    staffBrowser = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
      serviceWorkers: "block",
    });
  let phase = "EVENT_SETUP";
  try {
    const manual = fixture.composed.manualReports,
      events = fixture.composed.events,
      trips = fixture.composed.trips;
    if (!manual || !events || !trips) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
    const bytes = pngBytes(),
      image = await manual.upload(
        fixture.author,
        randomUUID(),
        "synthetic-event.png",
        (async function* () {
          yield bytes;
        })(),
        "image/png",
      );
    const report = await manual.submitReport(fixture.author, randomUUID(), {
      fields: { ...fixture.fields, cargoMassKg: "21000", evidenceIds: [image.id] },
    });
    const start = new Date(Date.now() + 12000).toISOString(),
      event = await events.create(fixture.staff, randomUUID(), {
        title: "Fictional confirmed attendance load",
        description: "Synthetic event exception",
        game: "ets2",
        server: "Synthetic",
        organizer: "Fictional company",
        route: "Synthetic route",
        meetingLocation: "Synthetic location",
        meetingAt: new Date(Date.now() + 11000).toISOString(),
        startsAt: start,
        endsAt: null,
        visibility: "members",
        originCityId: null,
        destinationCityId: null,
        prescribedCargoId: fixture.ids.fixture_crates as string,
        prescribedMassKg: "21000",
        prescribedTrailerTypeId: fixture.ids.fixture_trailer as string,
      });
    await write(page.request, "/auth/login", { email: fixture.email, password: fixture.password });
    await page.goto(`/account/trips/${report.tripId}`);
    await catalogLanguage(page);
    await page.locator("#report-event").selectOption(event.data.event.id);
    await confirm(page, "Associate event");
    let current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
    expect(current.summary.decision).not.toBe("accepted");
    await resetAccountLimits();
    phase = "CONFIRMED_ATTENDANCE";
    await expect.poll(() => Date.now() >= Date.parse(start), { timeout: 20000 }).toBe(true);
    await events.setAttendance(fixture.staff, event.data.event.id, randomUUID(), 1, {
      members: [{ memberId: fixture.userId, attendance: "attended", note: null }],
    });
    await page.reload();
    await catalogLanguage(page);
    const select = page.locator("#report-event");
    if ((await select.locator(`option[value="${event.data.event.id}"]`).count()) === 0) {
      await page.getByRole("button", { name: "Past events", exact: true }).click();
    }
    await select.selectOption(event.data.event.id);
    await confirm(page, "Associate event");
    await staffBrowser.addCookies((await staff.storageState()).cookies);
    const reviewer = await staffBrowser.newPage();
    await reviewer.goto(`/account/review/${report.tripId}`);
    await catalogLanguage(reviewer);
    await reviewer
      .locator("#review-reason")
      .fill("Fictional confirmed attendance and prescribed load");
    await confirm(reviewer, "Accept trip");
    current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
    expect(current.summary.decision).toBe("accepted");
    expect(current.decisions[0].basis.attendanceRevisionId).not.toBeNull();
    const frozen = current.summary.reportingAt;
    await resetAccountLimits();
    phase = "LATE_TELEMETRY";
    await fixture.telemetry({ tripId: report.tripId, expectedVersion: current.summary.version });
    current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
    expect(current.summary.decision).toBe("accepted");
    expect(current.summary.reportingAt).toBe(frozen);
    expect(current.summary.reportingBasis).toBe("manual_confirmation");
    expect(current.summary.sourceKinds.sort()).toEqual(["ets2telemetry", "manual"]);
    await reviewer.reload();
    await catalogLanguage(reviewer);
    await expect(
      reviewer
        .getByText("Pending review does not replace a previously confirmed result.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await reviewer.locator("#review-reason").fill("Fictional reviewed late source facts");
    await confirm(reviewer, "Accept trip");
    current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
    expect(current.decisions.length).toBeGreaterThanOrEqual(2);
    expect((await trips.status(fixture.author)).counts.accepted).toBe(1);
  } catch (error) {
    throw new Error(`SYNTHETIC_TRIP_EVENT_BROWSER_${phase}`, { cause: error });
  } finally {
    await staffBrowser.close();
    await staff.dispose();
    await fixture.close();
  }
});

test("real director cannot review an own manual report and ordinary driver cannot enter staff review", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await resetAccountLimits();
  const fixture = await tripBrowserFixture(),
    staff = await staffContext();
  try {
    const manual = fixture.composed.manualReports;
    if (!manual) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
    const bytes = pngBytes(),
      image = await manual.upload(
        fixture.staff,
        randomUUID(),
        "synthetic-own.png",
        (async function* () {
          yield bytes;
        })(),
        "image/png",
      );
    const own = await manual.submitReport(fixture.staff, randomUUID(), {
      fields: { ...fixture.fields, evidenceIds: [image.id] },
    });
    await context.addCookies((await staff.storageState()).cookies);
    await page.goto(`/account/review/${own.tripId}`);
    await catalogLanguage(page);
    await expect(
      page.getByText("You cannot review your own manual report, including merged groups.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept trip", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reject trip", exact: true })).toBeDisabled();
    const review = await staff.get(`/api/v1/trips/${own.tripId}/review`),
      body = (await review.json()).data;
    const denied = await write(
      staff,
      `/trips/${own.tripId}/decisions`,
      {
        decision: "accept",
        reviewedRevisionId: body.trip.manualRevision.id,
        factRevisionId: body.factRevisionId,
        proposalId: null,
        reason: "Synthetic forbidden self review",
      },
      review.headers().etag,
    );
    expect(denied.status()).toBe(403);
    await context.clearCookies();
    await write(page.request, "/auth/login", { email: fixture.email, password: fixture.password });
    await page.goto(`/account/review/${own.tripId}`);
    await catalogLanguage(page);
    await expect(
      page.getByText("Your current permissions do not allow this action.", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get(`/api/v1/trips/${own.tripId}/review`)).status()).toBe(404);
  } finally {
    await staff.dispose();
    await fixture.close();
  }
});
