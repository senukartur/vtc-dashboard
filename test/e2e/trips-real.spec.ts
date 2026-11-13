import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page, Request, Response } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { and, eq, isNull, trips as tripRows } from "@vtc/db/trips-schema";
import { pngBytes } from "../fixtures/manual-images.ts";
import { origin, resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage, chooseCatalogRow } from "./support/catalogs.ts";
import { expectDateTime, fillDateTime } from "./support/date-time.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { manualReferenceTimes } from "./support/manual-reference.ts";
import {
  diagnosticLocale,
  TripReadLedger,
  type TripReadSnapshot,
} from "./support/trip-read-diagnostics.ts";
import { tripBrowserFixture } from "./support/trips.ts";

test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });

type Schemas = components["schemas"];
const tripsPath = "/api/v1/trips";

async function workspaceSummary(request: APIRequestContext) {
  const response = await request.get("/api/v1/me/workspace-summary");
  expect(response.status()).toBe(200);
  return ((await response.json()) as Schemas["EnvelopeWorkspaceSummary"]).data;
}

async function rejectWorkspaceTrip(staff: APIRequestContext, tripId: string, reason: string) {
  const response = await staff.get(`/api/v1/trips/${tripId}/review`);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as Schemas["EnvelopeReview"];
  const revision = data.trip.manualRevision;
  if (!revision) throw new Error("SYNTHETIC_WORKSPACE_REVISION_REQUIRED");
  expect(
    (
      await write(
        staff,
        `/trips/${tripId}/decisions`,
        {
          decision: "reject",
          reviewedRevisionId: revision.id,
          factRevisionId: data.factRevisionId,
          proposalId: null,
          reason,
        },
        response.headers().etag,
      )
    ).status(),
  ).toBe(200);
}

test(
  "real workspace actions follow the latest report, editing draft, unanswered event and held review",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture(),
      staff = await staffContext();
    try {
      const { manualReports: manual, events } = fixture.composed;
      if (!manual || !events) throw new Error("SYNTHETIC_WORKSPACE_SOURCES_REQUIRED");
      const before = (await workspaceSummary(staff)).reviewQueue;
      if (!before) throw new Error("SYNTHETIC_REVIEW_SUMMARY_REQUIRED");
      const evidence = async (actor: typeof fixture.author) => {
        const image = await manual.upload(
          actor,
          randomUUID(),
          "synthetic-workspace.png",
          (async function* () {
            yield pngBytes();
          })(),
          "image/png",
        );
        return { ...fixture.fields, ...manualReferenceTimes, evidenceIds: [image.id] };
      };
      await manual.submitReport(fixture.staff, randomUUID(), {
        fields: await evidence(fixture.staff),
      });
      expect((await workspaceSummary(staff)).reviewQueue?.count).toBe(before.count);
      const editing = await manual.createDraft(fixture.author, randomUUID(), {
        fields: { comment: "Fictional editing draft" },
      });
      const submitted = await manual.createDraft(fixture.author, randomUUID(), { fields: {} });
      const held = await manual.submitDraft(
        fixture.author,
        submitted.id,
        randomUUID(),
        submitted.version,
        { fields: await evidence(fixture.author) },
      );
      const fields = await evidence(fixture.author);
      const returned = await manual.submitReport(fixture.author, randomUUID(), { fields });
      const earlierReason = "Fictional earlier return reason";
      const latestReason = "Fictional latest return reason";
      await rejectWorkspaceTrip(staff, returned.tripId, earlierReason);
      const report = await manual.getReport(fixture.author, returned.id);
      await manual.reviseReport(fixture.author, report.id, randomUUID(), report.version, {
        fields: { ...fields, comment: "Fictional revised report" },
        expectedTripVersion: report.tripVersion,
      });
      await rejectWorkspaceTrip(staff, returned.tripId, latestReason);
      const startsAt = Date.now() + 20 * 60_000;
      const {
        data: { event },
      } = await events.create(fixture.staff, randomUUID(), {
        title: "Fictional workspace RSVP convoy",
        description: "Synthetic convoy",
        game: "ets2",
        server: "Synthetic",
        organizer: "Fictional company",
        route: "Synthetic route",
        meetingLocation: "Synthetic location",
        meetingAt: new Date(startsAt - 60_000).toISOString(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: null,
        visibility: "members",
        originCityId: null,
        destinationCityId: null,
        prescribedCargoId: null,
        prescribedMassKg: null,
        prescribedTrailerTypeId: null,
      });
      expect(
        (
          await write(page.request, "/auth/login", {
            email: fixture.email,
            password: fixture.password,
          })
        ).status(),
      ).toBe(200);
      const author = await workspaceSummary(page.request);
      expect(author.tripsNeedingFixes).toEqual({
        count: 1,
        items: [{ tripId: returned.tripId, latestReturnReason: latestReason }],
      });
      expect(author.unfinishedManualDrafts).toMatchObject({
        count: 1,
        items: [{ draftId: editing.id }],
      });
      expect(author.unansweredUpcomingEvents?.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ eventId: event.id })]),
      );
      expect(author.reviewQueue).toBeUndefined();
      expect(author.newApplicationsCount).toBeUndefined();
      const eventCount = author.unansweredUpcomingEvents?.count ?? 0;
      await page.goto("/account/dashboard");
      await catalogLanguage(page);
      const actions = page.getByRole("region", { name: "Needs attention", exact: true });
      const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
      await expect(
        nav.getByRole("link", { name: "My trips (1 returned for fixes)", exact: true }),
      ).toBeVisible();
      await expect(
        nav.getByRole("link", {
          name: `Events (${eventCount} awaiting your response)`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(actions.getByText(latestReason, { exact: true })).toBeVisible();
      await expect(actions.getByText(earlierReason, { exact: true })).toHaveCount(0);
      await actions.getByRole("link", { name: "Open trip", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/account/trips/${returned.tripId}`);
      await nav.getByRole("link", { name: "Overview", exact: true }).click();
      const editingList = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/v1/me/manual-drafts" && url.searchParams.get("state") === "editing"
        );
      });
      await actions.getByRole("link", { name: "Editing drafts (1)", exact: true }).click();
      expect((await editingList).status()).toBe(200);
      await expect(page).toHaveURL(`${origin}/account/reports?state=editing`);
      await expect(page.getByRole("link", { name: "Continue draft", exact: true })).toHaveAttribute(
        "href",
        `/account/reports/drafts/${editing.id}`,
      );
      await expect(page.locator(`a[href="/account/reports/${held.id}/edit"]`)).toHaveCount(0);
      await nav.getByRole("link", { name: "Overview", exact: true }).click();
      await actions.getByRole("link", { name: /^Continue draft/ }).click();
      await expect(page).toHaveURL(`${origin}/account/reports/drafts/${editing.id}`);
      await expect(page.getByLabel("Comment (optional)")).toHaveValue("Fictional editing draft");
      // Draft navigation and RSVP are separate phases sharing the synthetic loopback read bucket.
      await resetAccountLimits();
      await nav.getByRole("link", { name: "Overview", exact: true }).click();
      await actions.getByRole("link", { name: event.title, exact: true }).click();
      await expect(page).toHaveURL(`${origin}/account/events/${event.id}`);
      const refreshed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/v1/me/workspace-summary",
      );
      await page
        .getByRole("group", { name: "Your response", exact: true })
        .getByRole("button", { name: "Participating", exact: true })
        .click();
      await expect(page.getByText("Response saved.", { exact: true })).toBeVisible();
      const nextEvents =
        eventCount === 1 ? "Events" : `Events (${eventCount - 1} awaiting your response)`;
      await expect(nav.getByRole("link", { name: nextEvents, exact: true })).toBeVisible();
      const refreshResponse = await refreshed;
      expect(refreshResponse.status()).toBe(200);
      const freshSummary = (await refreshResponse.json()) as Schemas["EnvelopeWorkspaceSummary"];
      expect(freshSummary.data.unansweredUpcomingEvents?.count).toBe(eventCount - 1);
      await nav.getByRole("link", { name: "Overview", exact: true }).click();
      await expect(actions.getByRole("link", { name: event.title, exact: true })).toHaveCount(0);

      await resetAccountLimits();
      await context.clearCookies();
      await context.addCookies((await staff.storageState()).cookies);
      const staffSummaryRead = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/v1/me/workspace-summary",
      );
      await page.goto("/account/dashboard");
      const staffSummaryResponse = await staffSummaryRead;
      expect(staffSummaryResponse.status()).toBe(200);
      const staffSummary =
        (await staffSummaryResponse.json()) as Schemas["EnvelopeWorkspaceSummary"];
      const overall = staffSummary.data.reviewQueue;
      if (!overall || overall.oldestAgeSeconds === null)
        throw new Error("SYNTHETIC_REVIEW_AGE_REQUIRED");
      expect(overall.count).toBe(before.count + 1);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      const total = new Intl.NumberFormat("en").format(overall.count);
      const seconds = overall.oldestAgeSeconds;
      const [divisor, unit] =
        seconds >= 3600
          ? ([3600, "hour"] as const)
          : seconds >= 60
            ? ([60, "minute"] as const)
            : ([1, "second"] as const);
      const age = new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
        -Math.floor(seconds / divisor),
        unit,
      );
      await expect(
        nav.getByRole("link", { name: `Dispatch (${total} awaiting decision)`, exact: true }),
      ).toBeVisible();
      const queueRead = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === tripsPath && url.searchParams.get("limit") === "25";
      });
      await actions
        .getByRole("link", { name: `Awaiting decision (${total})`, exact: true })
        .click();
      const queue = new URL((await queueRead).url()).searchParams;
      expect(queue.get("scope")).toBe("review");
      expect(queue.get("hold")).toBe("true");
      await expect(page).toHaveURL(`${origin}/account/review`);
      const waiting = page.getByText(`Awaiting decision overall (${total})`, { exact: true });
      const oldest = page.getByText(`Oldest waiting trip added ${age}`, { exact: true });
      await expect(waiting).toBeVisible();
      await expect(oldest).toBeVisible();
      await page.getByRole("button", { name: "Decided", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/account/review?tab=decided`);
      await expect(waiting).toBeVisible();
      await expect(oldest).toBeVisible();
    } finally {
      await staff.dispose();
      await fixture.close();
    }
  },
);

async function nextTripList(page: Page) {
  const response = await page.waitForResponse(
    (result) => result.request().method() === "GET" && new URL(result.url()).pathname === tripsPath,
  );
  expect(response.status()).toBe(200);
  return {
    query: new URL(response.url()).searchParams,
    data: ((await response.json()) as Schemas["EnvelopeListTripSummary"]).data,
  };
}

function expectOnlyAcceptedCompanyTrip(
  list: Schemas["ListTripSummary"],
  tripId: string,
  ownerId: string,
) {
  expect(list.total).toBe(1);
  expect(list.items).toHaveLength(1);
  const [trip] = list.items;
  expect(trip).toMatchObject({
    id: tripId,
    owner: { id: ownerId },
    view: "summary",
    decision: "accepted",
  });
  for (const field of [
    "event",
    "gameMode",
    "review",
    "manualRevision",
    "effectiveFacts",
    "decisions",
    "evidence",
  ])
    expect(trip).not.toHaveProperty(field);
}

function observeTripPage(page: Page) {
  const ledger = new TripReadLedger();
  const request = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.startsWith("/api/v1/")) ledger.request(path);
  };
  const response = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === "GET" && path.startsWith("/api/v1/"))
      ledger.response(path, response.status());
  };
  page.on("request", request);
  page.on("response", response);
  return {
    snapshot: () => ledger.snapshot(),
    stop: () => {
      page.off("request", request);
      page.off("response", response);
    },
  };
}
async function pageLocale(page: Page) {
  return diagnosticLocale(
    await page
      .locator("html")
      .getAttribute("lang", { timeout: 1000 })
      .catch(() => null),
  );
}
async function confirm(page: Page, label: string, commandPath?: string, expectedStatus = 201) {
  const actions = {
    "Submit for review": {
      action: "submit-report",
      path: /^\/api\/v1\/(?:manual-reports|me\/manual-drafts\/[0-9a-f-]{36}\/submission)$/,
    },
    "Revise and resubmit": {
      action: "revise-report",
      path: /^\/api\/v1\/manual-reports\/[0-9a-f-]{36}\/revisions$/,
    },
    "Reject trip": { action: "reject-trip", path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/decisions$/ },
    "Accept trip": { action: "accept-trip", path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/decisions$/ },
    "Propose supported resolution": {
      action: "propose-resolution",
      path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/resolution-proposals$/,
    },
    "Approve proposal": {
      action: "approve-proposal",
      path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/proposals\/[0-9a-f-]{36}\/decisions$/,
    },
    "Request correction": {
      action: "request-correction",
      path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/correction-requests$/,
    },
    "Merge trips": { action: "merge-trips", path: /^\/api\/v1\/reconciliations$/ },
    "Reverse merge": {
      action: "reverse-merge",
      path: /^\/api\/v1\/reconciliations\/[0-9a-f-]{36}\/reversals$/,
    },
    "Associate event": {
      action: "associate-event",
      path: /^\/api\/v1\/trips\/[0-9a-f-]{36}\/event-association$/,
    },
  } as const;
  const descriptor = Object.hasOwn(actions, label) ? actions[label as keyof typeof actions] : null;
  let originating: Request | null = null;
  const observation: {
    outcome: "pending" | "response" | "request-error";
    status: number | null;
    started: number;
    settled: number | null;
  } = { outcome: "pending", status: null, started: 0, settled: null };
  const start = (request: Request) => {
    if (
      !originating &&
      request.method() === "POST" &&
      descriptor?.path.test(new URL(request.url()).pathname)
    ) {
      originating = request;
      observation.started = Date.now();
    }
  };
  const settled = (response: Response) => {
    if (response.request() !== originating) return;
    observation.outcome = "response";
    const status = response.status();
    observation.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    observation.settled = Date.now();
  };
  const failed = (request: Request) => {
    if (request !== originating) return;
    observation.outcome = "request-error";
    observation.settled = Date.now();
  };
  page.on("request", start);
  page.on("response", settled);
  page.on("requestfailed", failed);
  try {
    // The decision panel names the submit button after the chosen outcome; choosing is idempotent.
    const choice = label === "Reject trip" ? "reject" : label === "Accept trip" ? "accept" : null;
    if (choice) await page.locator(`#review-choice-${choice}`).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    const response = commandPath
      ? page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === commandPath,
          { timeout: 15000 },
        )
      : null;
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    if (response) expect((await response).status()).toBe(expectedStatus);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    page.off("request", start);
    page.off("response", settled);
    page.off("requestfailed", failed);
    let buttonState: "closed" | "pending" | "confirm-enabled" | "confirm-disabled" | "unknown" =
      "unknown";
    try {
      const dialog = page.getByRole("dialog");
      if ((await dialog.count()) === 0) buttonState = "closed";
      else if ((await dialog.getByRole("button", { name: "Loading…", exact: true }).count()) > 0)
        buttonState = "pending";
      else {
        const button = dialog.getByRole("button", { name: "Confirm", exact: true });
        if ((await button.count()) === 1)
          buttonState = (await button.isEnabled({ timeout: 1000 }))
            ? "confirm-enabled"
            : "confirm-disabled";
      }
    } catch {
      /* A closed page cannot replace the original assertion failure. */
    }
    console.log(
      JSON.stringify({
        event: "trip_confirmation_browser_command",
        action: descriptor?.action ?? "unsupported",
        observed: originating !== null,
        outcome: observation.outcome,
        status: observation.status,
        elapsedMs: originating
          ? Math.min(180000, Math.max(0, (observation.settled ?? Date.now()) - observation.started))
          : 0,
        buttonState,
      }),
    );
  }
}
async function fill(page: Page, unresolved = false, initialReads?: TripReadSnapshot) {
  const lifecycle = observeTripPage(page),
    started = Date.now(),
    initialLocale = await pageLocale(page);
  let step:
      | "origin"
      | "destination"
      | "trailer"
      | "cargo"
      | "mass"
      | "distance"
      | "selection"
      | "file"
      | "upload"
      | "ready" = "origin",
    completed = false,
    stopUpload = () => {};
  try {
    await chooseCatalogRow(page, "Origin city", "Fictional fixture_north", "fixture_north");
    step = "destination";
    await chooseCatalogRow(page, "Destination city", "Fictional fixture_south", "fixture_south");
    step = "trailer";
    await chooseCatalogRow(page, "Trailer type", "Fictional fixture_box", "fixture_box");
    step = "cargo";
    if (unresolved) {
      await page.getByRole("combobox", { name: "Cargo", exact: true }).click();
      await page
        .getByRole("listbox", { name: "Cargo", exact: true })
        .getByRole("option", { name: /^Not listed/ })
        .click();
      await page
        .getByRole("group", { name: "Cargo", exact: true })
        .getByLabel("Diagnostic label", { exact: true })
        .fill("Fictional unmapped cargo");
    } else await chooseCatalogRow(page, "Cargo", "Fictional fixture_crates", "fixture_crates");
    step = "mass";
    await page.getByLabel("Cargo mass (kg)", { exact: true }).fill("18000");
    step = "distance";
    await page.getByLabel("Actual driven distance (m)", { exact: true }).fill("123400");
    await fillDateTime(page, "Trip start", manualReferenceTimes.startedAt.slice(0, 16));
    await fillDateTime(page, "Trip completion", manualReferenceTimes.completedAt.slice(0, 16));
    step = "selection";
    // Selecting an option starts a separate current-entity read. Settle this
    // setup before measuring upload, including reads queued by the shared lane.
    const selections: [string, string][] = [
      ["Origin city", "Fictional fixture_north"],
      ["Destination city", "Fictional fixture_south"],
      ["Trailer type", "Fictional fixture_box"],
    ];
    if (!unresolved) selections.push(["Cargo", "Fictional fixture_crates"]);
    for (const [label, rowName] of selections) {
      const combobox = page.getByRole("combobox", { name: label, exact: true }),
        field = page.locator(".catalog-selector").filter({ has: combobox });
      await expect(combobox).toHaveValue(rowName);
      await expect(combobox).not.toHaveAttribute("aria-busy", "true");
      await expect(field.getByText("Loading catalog…", { exact: true })).toHaveCount(0);
      await expect(
        field.getByText("This row could not be read. Its ID is kept.", {
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await expect(page.locator(".manual-company-field [role=status]")).toHaveCount(0);
    step = "file";
    await page
      .getByLabel("Choose completion screenshot", { exact: true })
      .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
    const requests: { method: string; category: string; operation: string }[] = [];
    const record = (request: import("@playwright/test").Request) => {
      const p = new URL(request.url()).pathname;
      if (p.startsWith("/api/v1/"))
        requests.push({
          method: request.method(),
          operation:
            p === "/api/v1/me"
              ? "self"
              : p.startsWith("/api/v1/catalogs/")
                ? "catalog"
                : p === "/api/v1/me/manual-drafts" || p.startsWith("/api/v1/me/manual-drafts/")
                  ? "draft"
                  : p === "/api/v1/trips" || p.startsWith("/api/v1/trips/")
                    ? "trip"
                    : p === "/api/v1/manual-reports" || p.startsWith("/api/v1/manual-reports/")
                      ? "report"
                      : p === "/api/v1/me/upload-policy"
                        ? "upload-policy"
                        : p === "/api/v1/notifications/history"
                          ? "notification-history"
                          : p === "/api/v1/events" || p.startsWith("/api/v1/events/")
                            ? "event"
                            : "unclassified",
          category:
            p === "/api/v1/auth/csrf"
              ? "csrf"
              : p.startsWith("/api/v1/evidence")
                ? "evidence"
                : p === "/api/v1/notifications" || p === "/api/v1/me/upcoming-event"
                  ? "shell"
                  : "other",
        });
    };
    page.on("request", record);
    stopUpload = () => page.off("request", record);
    step = "upload";
    await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
    step = "ready";
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
        shellReads: requests.filter((r) => r.method === "GET" && r.category === "shell").length,
        otherOperations: Object.fromEntries(
          [
            "self",
            "catalog",
            "draft",
            "trip",
            "report",
            "upload-policy",
            "notification-history",
            "event",
            "unclassified",
          ].map((operation) => [
            operation,
            Math.min(
              1024,
              requests.filter(
                (request) =>
                  request.method === "GET" &&
                  request.category === "other" &&
                  request.operation === operation,
              ).length,
            ),
          ]),
        ),
      }),
    );
    expect(requests.filter((r) => r.method === "GET" && r.category === "other")).toHaveLength(0);
    // One serialized feed delta/window and its shared header refresh may overlap upload.
    expect(
      requests.filter((r) => r.method === "GET" && r.category === "shell").length,
    ).toBeLessThanOrEqual(3);
    completed = true;
  } finally {
    stopUpload();
    lifecycle.stop();
    console.log(
      JSON.stringify({
        event: "trip_browser_fill",
        step,
        completed,
        elapsedMs: Math.min(180000, Math.max(0, Date.now() - started)),
        initialLocale,
        locale: await pageLocale(page),
        initialReads: initialReads ?? new TripReadLedger().snapshot(),
        reads: lifecycle.snapshot(),
      }),
    );
  }
}
async function proposal(staff: Awaited<ReturnType<typeof staffContext>>, tripId: string) {
  const response = await staff.get(`/api/v1/trips/${tripId}/proposals?limit=25`);
  expect(response.status()).toBe(200);
  return (await response.json()).data.items.find(
    (p: { state: string; kind: string }) => p.state === "pending" && p.kind === "resolution",
  );
}
/** Opens the review page's "Corrections and resolution" disclosure (open while a proposal is pending). */
async function corrections(page: Page) {
  const disclosure = page.locator("details.review-corrections");
  await expect(disclosure).toBeVisible();
  if (!(await disclosure.evaluate((node) => (node as HTMLDetailsElement).open)))
    await disclosure.locator(":scope > summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
}
async function approve(
  page: Page,
  staff: Awaited<ReturnType<typeof staffContext>>,
  tripId: string,
) {
  const p = await proposal(staff, tripId);
  if (!p) throw Error("SYNTHETIC_PROPOSAL_MISSING");
  await corrections(page);
  await page.locator("summary").filter({ hasText: p.id }).click();
  await page.locator(`#proposal-${p.id}`).fill("Fictional verified proposal");
  await confirm(page, "Approve proposal");
}
test(
  "real dated direct submission uses ready evidence and persists optional company and zero damage",
  browserCase(["@real"]),
  async ({ page }) => {
    test.setTimeout(60000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture();
    try {
      const catalogs = fixture.composed.catalogs;
      if (!catalogs) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
      const company = await catalogs.create(fixture.staff, "companies", randomUUID(), {
        game: "ets2",
        code: `synthetic-${randomUUID()}`,
        nameEn: "Fictional North Depot",
      });
      await catalogs.createDepot(fixture.staff, randomUUID(), {
        game: "ets2",
        cityId: fixture.fields.origin.entityId,
        companyId: company.id,
      });
      const login = await write(page.request, "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
      expect(login.status()).toBe(200);
      await page.goto("/account/reports/new");
      await catalogLanguage(page);
      await fill(page);
      // The shared database may hold more companies in the city, so the picker searches the code.
      const companyField = page.getByRole("combobox", {
        name: "Origin company (optional)",
        exact: true,
      });
      await companyField.fill(company.code);
      await page
        .getByRole("listbox", { name: "Origin company (optional)", exact: true })
        .getByRole("option", { name: `Fictional North Depot ${company.code}` })
        .click();
      await expect(companyField).toHaveValue(`Fictional North Depot · ${company.code}`);
      await page.getByLabel("Cargo damage (%) (optional)", { exact: true }).fill("0");
      await confirm(page, "Submit for review", "/api/v1/manual-reports");
      await expect(page).toHaveURL(/\/account\/trips\/[0-9a-f-]{36}$/);
      const tripId = new URL(page.url()).pathname.split("/").at(-1);
      const response = await page.request.get(`/api/v1/trips/${tripId}`);
      expect(response.status()).toBe(200);
      const trip = ((await response.json()) as Schemas["EnvelopeTripView"]).data;
      if (trip.view !== "private") throw Error("TRIP_PRIVATE_VIEW_MISSING");
      expect(trip.summary.sourceKinds).toEqual(["manual"]);
      expect(trip.manualRevision?.fields).toMatchObject({
        ...manualReferenceTimes,
        originCompanyId: company.id,
        cargoDamagePercent: 0,
      });
      expect(trip.manualRevision?.fields).not.toHaveProperty("destinationCompanyId");
      expect(trip.evidence[0]?.state).toBe("ready");
      await expect(
        page.getByRole("region", { name: "Driver-reported reference facts" }),
      ).toContainText("Fictional North Depot");
    } finally {
      await fixture.close();
    }
  },
);

test(
  "real report draft upload unresolved cargo stale review rejection revision acceptance correction attachment and reversible reconciliation",
  browserCase(["@real"]),
  async ({ page, browser }) => {
    test.setTimeout(180000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture(),
      staff = await staffContext(),
      staffContextBrowser = await browser.newContext({
        baseURL: "http://127.0.0.1:4173",
        viewport: page.viewportSize(),
        serviceWorkers: "block",
      });
    let phase:
      | "START"
      | "DRAFT"
      | "UPLOAD_SUBMIT"
      | "STALE_DECISION"
      | "RESUBMIT_ACCEPT"
      | "STAFF_RESOLUTION"
      | "CORRECTION"
      | "TELEMETRY_ATTACHMENT"
      | "DUPLICATE_MERGE"
      | "RELOAD_REVERSE"
      | "PRIVACY" = "START";
    let staffLocalePage: Page | null = null,
      stopRevise = () => {};
    const reviseObservation: {
      observed: boolean;
      outcome: "pending" | "response" | "request-error";
      status: number | null;
      started: number;
      settled: number | null;
    } = { observed: false, outcome: "pending", status: null, started: 0, settled: null };
    const mainReads = observeTripPage(page),
      mainStarted = Date.now();
    let attachmentStep:
      | "not-started"
      | "source"
      | "count"
      | "navigation"
      | "language"
      | "fill"
      | "draft"
      | "target" = "not-started";
    try {
      await staffContextBrowser.addCookies((await staff.storageState()).cookies);
      const staffPage = await staffContextBrowser.newPage();
      staffLocalePage = staffPage;
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
      await fillDateTime(page, "Trip start", manualReferenceTimes.startedAt.slice(0, 16));
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect(page).toHaveURL(/\/account\/reports\/drafts\//);
      await page.reload();
      await catalogLanguage(page);
      await expect(page.getByLabel("Comment (optional)", { exact: true })).toHaveValue(
        "Fictional durable partial draft",
      );
      await expectDateTime(page, "Trip start", manualReferenceTimes.startedAt.slice(0, 16));
      await expectDateTime(page, "Trip completion", "");
      await resetAccountLimits();
      phase = "UPLOAD_SUBMIT";
      await fill(page, true, mainReads.snapshot());
      const draftId = new URL(page.url()).pathname.split("/").at(-1);
      await confirm(page, "Submit for review", `/api/v1/me/manual-drafts/${draftId}/submission`);
      await expect(page).toHaveURL(/\/account\/trips\//);
      const tripId = new URL(page.url()).pathname.split("/").at(-1) as string;
      let current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
      expect(current.summary.decision).toBe("pending_review");
      expect(current.manualRevision.fields).toMatchObject(manualReferenceTimes);
      const reportId = current.manualRevision.reportId,
        evidenceIds = current.manualRevision.fields.evidenceIds;
      expect((await fixture.composed.trips?.status(fixture.author))?.counts.accepted).toBe(0);
      await staffPage.goto(`/account/review/${tripId}`);
      await catalogLanguage(staffPage);
      await resetAccountLimits();
      phase = "STALE_DECISION";
      await staffPage.locator("#review-choice-reject").click();
      await staffPage.locator("#review-reason").fill("Fictional rejection after current review");
      await staffPage.getByRole("button", { name: "Reject trip", exact: true }).click();
      await page.goto(`/account/reports/${reportId}/edit`);
      await catalogLanguage(page);
      await page
        .getByLabel("Comment (optional)", { exact: true })
        .fill("Fictional edit after staff opened review");
      const revisedCompletion = "2025-01-12T11:15:00.000Z";
      await fillDateTime(page, "Trip completion", revisedCompletion.slice(0, 16));
      const revisePath = `/api/v1/manual-reports/${reportId}/revisions`;
      let observedRevision: Request | null = null;
      const revisionRequest = (request: Request) => {
        if (
          !reviseObservation.observed &&
          request.method() === "POST" &&
          new URL(request.url()).pathname === revisePath
        ) {
          observedRevision = request;
          reviseObservation.observed = true;
          reviseObservation.started = Date.now();
        }
      };
      const revisionResponse = (response: Response) => {
        if (response.request() !== observedRevision) return;
        reviseObservation.outcome = "response";
        const status = response.status();
        reviseObservation.status = status >= 100 && status <= 599 ? status : null;
        reviseObservation.settled = Date.now();
      };
      const revisionFailed = (request: Request) => {
        if (request !== observedRevision) return;
        reviseObservation.outcome = "request-error";
        reviseObservation.settled = Date.now();
      };
      page.on("request", revisionRequest);
      page.on("response", revisionResponse);
      page.on("requestfailed", revisionFailed);
      stopRevise = () => {
        page.off("request", revisionRequest);
        page.off("response", revisionResponse);
        page.off("requestfailed", revisionFailed);
      };
      await confirm(page, "Revise and resubmit", revisePath, 200);
      await expect(page).toHaveURL(new RegExp(`/account/trips/${tripId}$`));
      const revised = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
      expect(revised.manualRevision.fields).toMatchObject({
        startedAt: manualReferenceTimes.startedAt,
        completedAt: revisedCompletion,
      });
      stopRevise();
      await staffPage
        .getByRole("dialog")
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
      await expect(staffPage.getByRole("dialog")).toHaveCount(0);
      await expect(
        staffPage.getByRole("alert").filter({ hasText: "record changed" }),
      ).toBeVisible();
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
      await corrections(staffPage);
      await staffPage.getByText("Propose supported resolution", { exact: true }).click();
      await chooseCatalogRow(staffPage, "Cargo", "Fictional fixture_crates", "fixture_crates");
      await staffPage
        .locator("#resolution-reason")
        .fill("Fictional cargo confirmed from screenshot");
      await confirm(staffPage, "Propose supported resolution");
      await approve(staffPage, staff, tripId);
      current = (await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).data;
      expect(current.summary.decision).toBe("accepted");
      expect(current.decisions.some((d: { outcome: string }) => d.outcome === "rejected")).toBe(
        true,
      );
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
        await (
          await page.request.get(`/api/v1/trips/${tripId}/correction-requests?limit=25`)
        ).json()
      ).data.items;
      expect(requests.filter((r: { status: string }) => r.status === "pending")).toHaveLength(1);
      const requestId = requests.find((r: { status: string }) => r.status === "pending").id;
      await staffPage.reload();
      await catalogLanguage(staffPage);
      await corrections(staffPage);
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
      attachmentStep = "source";
      const telemetry = await fixture.telemetry(undefined, "started");
      attachmentStep = "count";
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
      attachmentStep = "navigation";
      await page.goto("/account/reports/new");
      attachmentStep = "language";
      await catalogLanguage(page);
      attachmentStep = "fill";
      await fill(page, false, mainReads.snapshot());
      attachmentStep = "draft";
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect(page).toHaveURL(/\/account\/reports\/drafts\//);
      attachmentStep = "navigation";
      await page.reload();
      attachmentStep = "language";
      await catalogLanguage(page);
      attachmentStep = "target";
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
        fields: { ...fixture.fields, ...manualReferenceTimes, evidenceIds },
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
        expect((await visitor.request.get(`/api/v1/evidence/${evidenceIds[0]}`)).status()).toBe(
          404,
        );
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
      stopRevise();
      mainReads.stop();
      console.log(
        JSON.stringify({
          event: "trip_revision_browser_command",
          phase: "stale-decision-revise",
          observed: reviseObservation.observed,
          outcome: reviseObservation.outcome,
          status: reviseObservation.status,
          elapsedMs: reviseObservation.observed
            ? Math.min(
                180000,
                Math.max(0, (reviseObservation.settled ?? Date.now()) - reviseObservation.started),
              )
            : 0,
        }),
      );
      console.log(
        JSON.stringify({
          event: "trip_browser_main",
          phase: "telemetry-attachment",
          currentPhase: phase,
          reached: attachmentStep !== "not-started",
          step: attachmentStep,
          locale: await pageLocale(page),
          staffLocale: staffLocalePage ? await pageLocale(staffLocalePage) : "other",
          elapsedMs: Math.min(180000, Math.max(0, Date.now() - mainStarted)),
          reads: mainReads.snapshot(),
        }),
      );
      await staffContextBrowser.close();
      await staff.dispose();
      await fixture.close();
    }
  },
);

test(
  "real trip list finds both number spellings and another driver's history shows accepted trips only",
  browserCase(["@real"]),
  async ({ page, browser }) => {
    test.setTimeout(90000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture();
    try {
      const completed = await fixture.telemetry();
      const active = await fixture.telemetry(undefined, "started");
      const login = await write(page.request, "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
      expect(login.status()).toBe(200);
      await page.goto("/account/preferences");
      await catalogLanguage(page);

      const [initial] = await Promise.all([nextTripList(page), page.goto("/account/trips")]);
      expect(initial.query.get("scope")).toBe("mine");
      expect(initial.query.get("order")).toBe("completion_desc");
      expect(initial.data.total).toBe(2);
      expect(initial.data.items.map((item) => [item.id, item.decision])).toEqual([
        [completed.tripId, "accepted"],
        [active.tripId, "unassessed"],
      ]);
      const trip = initial.data.items[0];
      if (!trip?.number || !trip.reportingAt) throw new Error("SYNTHETIC_TRIP_LIST_FACT_MISSING");
      expect(trip.reportingBasis).toBe("actual_completion");
      const rowLink = page.locator(`#trip-link-${completed.tripId}`);
      const row = page.getByRole("row").filter({ has: rowLink });
      await expect(rowLink).toContainText(`#${trip.number}`);
      await expect(page.getByText("Found 2", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Lifetime accepted trips · 1 · 123.4 km", { exact: true }),
      ).toBeVisible();
      expect(trip.gameMode).toBe("unknown");
      await expect(row.getByText("Unknown", { exact: true })).toBeVisible();

      const search = page.getByRole("searchbox", { name: "City, cargo, trip number" });
      for (const term of [`#${trip.number}`, String(trip.number)]) {
        const [matched] = await Promise.all([nextTripList(page), search.fill(term)]);
        expect(matched.query.get("q")).toBe(term);
        expect(matched.query.get("locale")).toBe("en");
        expect(matched.data.total).toBe(1);
        expect(matched.data.items.map((item) => item.id)).toEqual([completed.tripId]);
        await expect(rowLink).toBeVisible();
        await expect(page.getByText("Found 1", { exact: true })).toBeVisible();
      }
      const sort = page.getByRole("button", { name: "Completion", exact: true });
      await expect(sort.locator("..")).toHaveAttribute("aria-sort", "descending");
      const [sorted] = await Promise.all([nextTripList(page), sort.click()]);
      expect(sorted.query.get("order")).toBe("completion_asc");
      await expect(sort.locator("..")).toHaveAttribute("aria-sort", "ascending");

      // New synthetic identities default to UTC. Freeze the browser clock to the fixture's
      // reporting date so the period assertions are independent of wall-clock rollover.
      const at = new Date(trip.reportingAt);
      await page.clock.setFixedTime(at);
      const month = (offset: number) =>
        new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1)).toISOString();
      const period = page.getByRole("combobox", { name: "Period", exact: true });
      for (const [preset, from, toExclusive, total] of [
        ["thisMonth", month(0), month(1), 1],
        ["lastMonth", month(-1), month(0), 0],
      ] as const) {
        const [filtered] = await Promise.all([nextTripList(page), period.selectOption(preset)]);
        expect(filtered.query.get("from")).toBe(from);
        expect(filtered.query.get("toExclusive")).toBe(toExclusive);
        expect(filtered.query.get("q")).toBe(String(trip.number));
        expect(filtered.query.get("order")).toBe("completion_asc");
        expect(filtered.data.total).toBe(total);
        await expect(page.getByText(`Found ${total}`, { exact: true })).toBeVisible();
      }
      await expect(
        page.getByText("Lifetime accepted trips · 1 · 123.4 km", { exact: true }),
      ).toBeVisible();

      const another = await fixture.newMember();
      const company = await browser.newContext({
        baseURL: origin,
        viewport: page.viewportSize(),
        serviceWorkers: "block",
      });
      try {
        const visitor = await company.newPage();
        const visitorLogin = await write(visitor.request, "/auth/login", {
          email: another.email,
          password: another.password,
        });
        expect(visitorLogin.status()).toBe(200);
        // Set the locale before observing the profile so a locale change cannot refetch history.
        await visitor.goto("/account/preferences");
        await catalogLanguage(visitor);
        let profileTripReads = 0;
        const trackProfileTrips = (request: Request) => {
          if (request.method() === "GET" && new URL(request.url()).pathname === tripsPath)
            profileTripReads += 1;
        };
        visitor.on("request", trackProfileTrips);
        const [profileResponse, recent] = await Promise.all([
          visitor.waitForResponse(
            (response) =>
              response.request().method() === "GET" &&
              new URL(response.url()).pathname === `/api/v1/members/${fixture.userId}`,
          ),
          nextTripList(visitor),
          visitor.goto(`/account/drivers/${fixture.userId}`),
        ]);
        expect(profileResponse.status()).toBe(200);
        const profile = ((await profileResponse.json()) as Schemas["EnvelopeMemberProfile"]).data;
        expect(profile.lifetimeTotals).toEqual({ acceptedTrips: 1, actualDistanceM: "123400" });
        expect(Object.fromEntries(recent.query)).toEqual({
          scope: "company",
          ownerId: fixture.userId,
          limit: "10",
          order: "completion_desc",
          locale: "en",
        });
        expectOnlyAcceptedCompanyTrip(recent.data, completed.tripId, fixture.userId);
        const history = visitor.getByRole("region", { name: "Accepted trips", exact: true });
        await expect(
          history.getByText("Lifetime · 1 accepted · 123.4 km", { exact: true }),
        ).toBeVisible();
        await expect(history.getByRole("row")).toHaveCount(2);
        expect(profileTripReads).toBe(1);
        visitor.off("request", trackProfileTrips);

        const allTrips = history.getByRole("link", {
          name: `All trips by ${profile.member.nickname}`,
          exact: true,
        });
        const [selected] = await Promise.all([nextTripList(visitor), allTrips.click()]);
        await expect(visitor).toHaveURL(`/account/trips?scope=company&ownerId=${fixture.userId}`);
        expect(selected.query.get("ownerId")).toBe(fixture.userId);
        expect(selected.query.get("scope")).toBe("company");
        expectOnlyAcceptedCompanyTrip(selected.data, completed.tripId, fixture.userId);
        await expect(visitor.getByText("Found 1", { exact: true })).toBeVisible();
        await expect(visitor.locator(`#trip-link-${completed.tripId}`)).toContainText(
          `#${trip.number}`,
        );
        await expect(visitor.locator(`#trip-link-${active.tripId}`)).toHaveCount(0);
      } finally {
        await company.close();
      }
    } finally {
      await fixture.close();
    }
  },
);

test(
  "real owner event association requires confirmed attendance and late telemetry preserves the confirmed result until staff review",
  browserCase(["@real"]),
  async ({ page, browser }) => {
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
        fields: {
          ...fixture.fields,
          ...manualReferenceTimes,
          cargoMassKg: "21000",
          evidenceIds: [image.id],
        },
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
          prescribedTrailerTypeId: fixture.ids.fixture_box as string,
        });
      await write(page.request, "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
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
      phase = "P2_EVENT_SUMMARY";
      await page.goto("/account/trips");
      const ownRow = page.getByRole("row").filter({
        has: page.locator(`#trip-link-${report.tripId}`),
      });
      await expect(
        ownRow.getByRole("link", { name: event.data.event.title, exact: true }),
      ).toHaveAttribute("href", `/account/events/${event.data.event.id}`);
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
  },
);

test(
  "real dispatcher accepts an over-limit manual report and late telemetry returns it for review",
  browserCase(["@real"]),
  async ({ page, browser }) => {
    test.setTimeout(90000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture(),
      staff = await staffContext(),
      staffBrowser = await browser.newContext({
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
    let phase = "OVER_LIMIT_REPORT";
    try {
      const manual = fixture.composed.manualReports,
        trips = fixture.composed.trips;
      if (!manual || !trips) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
      const bytes = pngBytes(),
        image = await manual.upload(
          fixture.author,
          randomUUID(),
          "synthetic-over-limit.png",
          (async function* () {
            yield bytes;
          })(),
          "image/png",
        );
      // The fixture level allows 20 t; the report declares 21 t.
      const report = await manual.submitReport(fixture.author, randomUUID(), {
        fields: {
          ...fixture.fields,
          ...manualReferenceTimes,
          cargoMassKg: "21000",
          evidenceIds: [image.id],
        },
      });
      const nickname = (await (await staff.get("/api/v1/me")).json()).data.member
        .nickname as string;
      await staffBrowser.addCookies((await staff.storageState()).cookies);
      const reviewer = await staffBrowser.newPage();
      await reviewer.goto(`/account/review/${report.tripId}`);
      await catalogLanguage(reviewer);
      phase = "ACCEPT_OVER_LIMITS";
      await reviewer.locator("#review-choice-accept").click();
      await expect(reviewer.locator(".review-over-limits .review-limits li")).toHaveCount(1);
      await reviewer.locator("#review-reason").fill("Fictional waiver for a documented convoy");
      await expect(
        reviewer.getByRole("button", { name: "Accept trip", exact: true }),
      ).toBeDisabled();
      await reviewer.locator("#review-confirm-limits").check();
      await confirm(reviewer, "Accept trip");
      const latest = reviewer.locator(".review-history li").first();
      await expect(latest).toContainText("Accepted over limits");
      await expect(latest).toContainText(nickname);
      await write(page.request, "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
      let current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
      expect(current.summary.decision).toBe("accepted");
      expect(current.decisions[0].acceptedOverLimits).toBe(true);
      expect((await trips.status(fixture.author)).counts.accepted).toBe(1);
      await resetAccountLimits();
      phase = "LATE_TELEMETRY";
      // Matching telemetry confirms the breach and returns the trip to the queue.
      await fixture.telemetry(
        { tripId: report.tripId, expectedVersion: current.summary.version },
        "completed",
        21000,
      );
      await reviewer.goto("/account/review?order=desc");
      await catalogLanguage(reviewer);
      const link = reviewer.locator(`#trip-link-${report.tripId}`),
        row = reviewer.locator("#review-queue-table tbody tr").filter({ has: link });
      await expect(row).toContainText("Late telemetry");
      await link.click();
      await expect(reviewer.locator("#review-choice-accept")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await expect(reviewer.locator("#review-choice-accept")).toHaveAccessibleDescription(
        /^Acceptance is unavailable/,
      );
      phase = "REJECT";
      await reviewer.locator("#review-choice-reject").click();
      await reviewer.locator("#review-reason").fill("Fictional telemetry confirms the breach");
      await confirm(reviewer, "Reject trip");
      current = (await (await page.request.get(`/api/v1/trips/${report.tripId}`)).json()).data;
      expect(current.summary.decision).toBe("rejected");
      expect((await trips.status(fixture.author)).counts.accepted).toBe(0);
    } catch (error) {
      throw new Error(`SYNTHETIC_TRIP_OVER_LIMIT_BROWSER_${phase}`, { cause: error });
    } finally {
      await staffBrowser.close();
      await staff.dispose();
      await fixture.close();
    }
  },
);

test(
  "real director cannot review an own manual report and ordinary driver cannot enter staff review",
  browserCase(["@real"]),
  async ({ page, context }) => {
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
        fields: { ...fixture.fields, ...manualReferenceTimes, evidenceIds: [image.id] },
      });
      await context.addCookies((await staff.storageState()).cookies);
      await page.goto(`/account/review/${own.tripId}`);
      await catalogLanguage(page);
      await expect(
        page.getByText("You cannot review your own manual report, including merged groups.", {
          exact: true,
        }),
      ).toBeVisible();
      // An own report shows only the note: no choice, reason or submit control is rendered.
      for (const id of ["#review-choice-accept", "#review-choice-reject", "#review-reason"])
        await expect(page.locator(id)).toHaveCount(0);
      for (const name of ["Accept trip", "Reject trip", "Record decision"])
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
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
      await write(page.request, "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
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
  },
);
