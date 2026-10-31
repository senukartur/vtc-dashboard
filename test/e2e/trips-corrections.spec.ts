import type { Page } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import { catalogLanguage, entityId, envelope, list } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { cargoId, evidenceId, example, id, mockTrips, trailerId } from "./support/trip-ui.ts";

const targetA = "47000000-0000-4000-8000-000000000001",
  targetB = "47000000-0000-4000-8000-000000000002";
const pin = (entityId: string) => ({
  status: "resolved",
  entityId,
  catalogRevisionId: "61000000-0000-4000-8000-000000000020",
});
const fields = () => ({
  game: "ets2",
  origin: pin(entityId),
  destination: pin(entityId),
  cargo: pin(cargoId),
  trailerType: pin(trailerId),
  cargoMassKg: "1000",
  actualDistanceM: "0",
  evidenceIds: [evidenceId],
  eventId: null,
  comment: "Fictional preserved draft",
});
async function draftFixture(
  page: Page,
  initial: { tripId: string; expectedVersion: number } | null = null,
) {
  await mockTrips(page);
  const draft = example("getMyManualDraft:success").data;
  draft.id = id;
  draft.fields = fields();
  draft.targetTrip = initial;
  draft.version = 1;
  draft.submittedReportId = null;
  const saves: unknown[] = [];
  await page.route(`**/api/v1/me/manual-drafts/${id}`, async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      draft.fields = body.fields;
      draft.targetTrip = body.targetTrip;
      draft.version++;
    }
    return route.fulfill({ json: envelope(draft), headers: { ETag: `"v${draft.version}"` } });
  });
  return { draft, saves };
}
async function selectFile(page: Page) {
  await page
    .getByLabel("Choose completion screenshot", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
}

test("corrective URL history never crosses filter cursor authority and refresh recovers the first page", async ({
  page,
}) => {
  await mockTrips(page);
  const requests: { key: string; cursor: string | null }[] = [];
  let failNext = false;
  await page.route("**/api/v1/trips?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    const key = [q.get("scope"), q.get("game"), q.get("decision")].join(":");
    const cursor = q.get("cursor");
    requests.push({ key, cursor });
    if ((cursor && cursor !== key) || (cursor && failNext)) {
      failNext = false;
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    }
    return route.fulfill({ json: envelope({ items: [], nextCursor: cursor ? null : key }) });
  });
  await page.goto("/account/trips?game=ets2&decision=pending_review");
  await catalogLanguage(page);
  const next = page.getByRole("button", { name: "Next page", exact: true });
  await next.click();
  await expect.poll(() => requests.at(-1)?.cursor).toBe("mine:ets2:pending_review");
  await page.getByLabel("Game", { exact: true }).selectOption("ats");
  await expect.poll(() => requests.at(-1)?.key).toBe("mine:ats:pending_review");
  await next.click();
  await expect.poll(() => requests.at(-1)?.cursor).toBe("mine:ats:pending_review");
  await page.goBack();
  await expect
    .poll(() => requests.at(-1))
    .toEqual({ key: "mine:ets2:pending_review", cursor: null });
  await page.goForward();
  await expect
    .poll(() => requests.at(-1))
    .toEqual({ key: "mine:ats:pending_review", cursor: null });
  await page.getByLabel("Company decision", { exact: true }).selectOption("accepted");
  await next.click();
  await expect.poll(() => requests.at(-1)?.cursor).toBe("mine:ats:accepted");
  await page.getByRole("button", { name: "Accepted company trips", exact: true }).click();
  await next.click();
  await expect.poll(() => requests.at(-1)?.cursor).toBe("company:ats:");
  await page.goBack();
  await expect.poll(() => requests.at(-1)).toEqual({ key: "mine:ats:accepted", cursor: null });
  failNext = true;
  await next.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => requests.at(-1)).toEqual({ key: "mine:ats:accepted", cursor: null });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(requests.every((r) => !r.cursor || r.cursor === r.key)).toBe(true);
});

for (const scenario of ["null_to_A", "A_to_B", "A_to_clear", "A_refreshed"] as const) {
  test(`corrective saved draft persists the exact ${scenario} telemetry intent before confirmation`, async ({
    page,
  }, info) => {
    const initial = scenario === "null_to_A" ? null : { tripId: targetA, expectedVersion: 1 };
    const { draft, saves } = await draftFixture(page, initial);
    let currentVersion = 1;
    const summary = (tripId: string) => ({
      ...example("getTrip:success").data,
      id: tripId,
      game: "ets2",
      decision: "pending_review",
      owner: accountFixture("en").data.member,
      version: currentVersion,
      sourceKinds: ["ets2telemetry"],
    });
    await page.route("**/api/v1/trips?*", (route) =>
      route.fulfill({ json: list([summary(targetA), summary(targetB)]) }),
    );
    await page.route(/\/api\/v1\/trips\/47000000-0000-4000-8000-00000000000[12]$/, (route) =>
      route.fulfill({
        json: envelope(
          summary(new URL(route.request().url()).pathname.split("/").at(-1) as string),
        ),
        headers: { ETag: `"v${currentVersion}"` },
      }),
    );
    const submitted: unknown[] = [];
    await page.route(`**/api/v1/me/manual-drafts/${id}/submission`, (route) => {
      submitted.push(route.request().postDataJSON());
      return route.abort("failed");
    });
    await page.goto(`/account/reports/drafts/${id}`);
    await catalogLanguage(page);
    // The language switch now waits for the authenticated shell; let reads it re-keyed settle.
    await expect(page.getByRole("status").filter({ hasText: /^Loading…$/ })).toHaveCount(0);
    if (scenario === "A_refreshed") {
      currentVersion = 2;
      await page.getByRole("button", { name: "Reload telemetry targets", exact: true }).click();
    } else
      await page
        .locator("#manual-target")
        .selectOption(scenario === "A_to_clear" ? "" : scenario === "A_to_B" ? targetB : targetA);
    const expected =
      scenario === "A_to_clear"
        ? null
        : {
            tripId: scenario === "A_to_B" ? targetB : targetA,
            expectedVersion: scenario === "A_refreshed" ? 2 : 1,
          };
    const submit = page.getByRole("button", { name: "Submit for review", exact: true });
    await expect(submit).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Save the draft");
    expect(submitted).toHaveLength(0);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(submit).toBeEnabled();
    expect(draft.targetTrip).toEqual(expected);
    expect(saves).toHaveLength(1);
    await submit.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Send these exact report details");
    await expect(dialog).not.toContainText("Report submitted");
    if (expected) await expect(dialog).toContainText(expected.tripId);
    else await expect(dialog).toContainText("Create a separate trip");
    await dialog.screenshot({ path: info.outputPath(`saved-intent-${scenario}-en.png`) });
    if (scenario === "A_to_clear") {
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await catalogLanguage(page, "ru");
      await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
      await expect(dialog).toContainText("Передайте эти данные отчёта на проверку");
      await expect(dialog).not.toContainText("Отчёт отправлен");
      await dialog.screenshot({ path: info.outputPath("saved-intent-clear-ru.png") });
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await catalogLanguage(page);
      await submit.click();
    }

    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({ fields: draft.fields });
    expect(draft.targetTrip).toEqual(expected);
    await expect(page.getByLabel("Comment (optional)", { exact: true })).toHaveValue(
      "Fictional preserved draft",
    );
  });
}

test("corrective immutable history compares only a proven same-report predecessor", async ({
  page,
}) => {
  await mockTrips(page);
  const view = example("getTrip:extended-manual-revision");
  view.data.manualRevision = null;
  const reportA = "48000000-0000-4000-8000-000000000001",
    reportB = "48000000-0000-4000-8000-000000000002";
  const revision = (tail: number, reportId: string, number: number, comment: string) => ({
    id: `49000000-0000-4000-8000-${String(tail).padStart(12, "0")}`,
    representation: "extended",
    reportId,
    number,
    submittedAt: "2026-10-24T12:00:00.000Z",
    fields: { ...fields(), comment },
  });
  const a2 = revision(2, reportA, 2, "Fictional report A revision 2"),
    b1 = revision(3, reportB, 1, "Fictional report B revision 1"),
    a1 = revision(1, reportA, 1, "Fictional report A revision 1");
  const legacy2 = example("getManualRevision:success").data;
  legacy2.number = 2;
  legacy2.id = "49000000-0000-4000-8000-000000000004";
  const legacy1 = structuredClone(legacy2);
  legacy1.id = "49000000-0000-4000-8000-000000000005";
  legacy1.number = 1;
  legacy1.fields.comment = "Fictional unrelated legacy entry";
  await page.route(`**/api/v1/trips/${id}`, (route) =>
    route.fulfill({ json: view, headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/v1/trips/${id}/manual-revisions?*`, (route) =>
    route.fulfill({ json: list([a2, b1, a1, legacy2, legacy1]) }),
  );
  await page.goto(`/account/trips/${id}`);
  await catalogLanguage(page);
  await page.locator("summary").filter({ hasText: "Private report and review history" }).click();
  const a = page.locator("section.trip-revision").filter({ hasText: a2.id });
  await expect(a).toContainText(reportA);
  await expect(a.locator("del")).toHaveText("Fictional report A revision 1");
  await expect(a.locator("ins")).toHaveText("Fictional report A revision 2");
  await expect(a.locator("del")).not.toContainText("report B");
  const b = page.locator("section.trip-revision").filter({ hasText: b1.id });
  await expect(b).toContainText(reportB);
  await expect(b.locator("del,ins")).toHaveCount(0);
  const legacy = page.locator("section.trip-revision").filter({ hasText: legacy2.id });
  await expect(legacy).toContainText("unavailable for comparison");
  await expect(legacy.locator("del,ins")).toHaveCount(0);
  await expect(legacy).toContainText("Revision 2");
});

test("corrective removed evidence cannot return when another upload settles", async ({ page }) => {
  const { draft, saves } = await draftFixture(page);
  const newId = "43000000-0000-4000-8000-000000000031";
  let release: () => void = () => {},
    started = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/evidence", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    started = true;
    await held;
    return route.fulfill({
      status: 202,
      json: envelope({
        id: newId,
        state: "ready",
        contentType: "image/png",
        byteLength: pngBytes().length,
        originalName: "synthetic.png",
      }),
    });
  });
  await page.route(`**/api/v1/evidence/${newId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: newId,
        state: "ready",
        contentType: "image/png",
        byteLength: pngBytes().length,
        originalName: "synthetic.png",
      }),
    }),
  );
  const submitted: unknown[] = [];
  await page.route(`**/api/v1/me/manual-drafts/${id}/submission`, (route) => {
    submitted.push(route.request().postDataJSON());
    return route.abort("failed");
  });
  try {
    await page.goto(`/account/reports/drafts/${id}`);
    await catalogLanguage(page);
    await expect(page.getByText(evidenceId, { exact: true })).toBeVisible();
    await selectFile(page);
    await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText(evidenceId, { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText(newId, { exact: true })).toBeVisible();
    await expect(page.getByText(evidenceId, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(draft.fields.evidenceIds).toEqual([newId]);
    await page.getByRole("button", { name: "Submit for review", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({ fields: draft.fields });
  } finally {
    release();
  }
});

test("corrective Russian summaries visibly distinguish English catalog fallbacks", async ({
  page,
}, info) => {
  await mockTrips(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const make = (flag: boolean, tripId: string) => {
    const value = example("getTrip:success").data;
    value.id = tripId;
    for (const field of ["origin", "destination", "cargo"])
      value[field] = {
        entityId,
        label: `Fictional ${field} with a long catalog label`,
        requestedLocale: "ru",
        renderedLocale: flag ? "en" : "ru",
        englishFallback: flag,
        retired: false,
      };
    return value;
  };
  await page.route("**/api/v1/trips?*", (route) =>
    route.fulfill({ json: list([make(true, id), make(false, targetB)]) }),
  );
  await page.goto("/account/trips");
  await catalogLanguage(page, "ru");
  const flagged = page.locator("article.trip-row").first(),
    ordinary = page.locator("article.trip-row").nth(1);
  await expect(flagged.getByText("Показано на английском", { exact: false })).toHaveCount(3);
  await expect(ordinary).not.toContainText("Показано на английском");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("catalog-fallback-ru.png"), fullPage: true });
});

test("corrective reconciliation refresh restarts a cursor invalidated by reversal", async ({
  page,
}) => {
  await mockTrips(page);
  const firstId = "4a000000-0000-4000-8000-000000000001",
    secondId = "4a000000-0000-4000-8000-000000000002";
  const operation = (opId: string, state = "applied") => ({
    id: opId,
    version: state === "applied" ? 1 : 2,
    primaryTripId: id,
    secondaryTripId: targetA,
    primaryVersion: 1,
    secondaryVersion: 1,
    state,
  });
  let changed = false;
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/reconciliation-candidates?*", (route) =>
    route.fulfill({ json: list([]) }),
  );
  await page.route(`**/api/v1/trips/${id}/reconciliations?*`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (changed && cursor)
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    return route.fulfill({
      json: envelope({
        items: [
          operation(
            cursor ? secondId : changed ? secondId : firstId,
            changed ? "reversed" : "applied",
          ),
        ],
        nextCursor: cursor || changed ? null : "root-version-one",
      }),
    });
  });
  await page.route(`**/api/v1/reconciliations/${secondId}`, (route) =>
    route.fulfill({ json: envelope(operation(secondId)), headers: { ETag: '"v1"' } }),
  );
  for (const tripId of [id, targetA])
    await page.route(`**/api/v1/trips/${tripId}`, (route) => {
      const view = example("getTrip:extended-manual-revision");
      view.data.summary.id = tripId;
      view.data.summary.owner = { ...view.data.summary.owner, id: targetB };
      view.data.summary.sourceKinds = ["ets2telemetry"];
      return route.fulfill({ json: view, headers: { ETag: '"v1"' } });
    });
  await page.route(`**/api/v1/reconciliations/${secondId}/reversals`, (route) => {
    changed = true;
    return route.fulfill({
      json: envelope(operation(secondId, "reversed")),
      headers: { ETag: '"v2"' },
    });
  });
  await page.goto(`/account/review/reconciliation?trip=${id}`);
  await catalogLanguage(page);
  const summary = page.locator("summary").filter({ hasText: "Reconciliation history" });
  await summary.click();
  const history = page.locator("details").filter({ has: summary }).first();
  await history.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.poll(() => cursors.at(-1)).toBe("root-version-one");
  await history.locator("summary").filter({ hasText: secondId }).click();
  await page.locator(`#reverse-${secondId}`).fill("Fictional independent journeys restored");
  await history.getByRole("button", { name: "Reverse merge", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(history.getByRole("alert")).toBeVisible();
  await history.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => cursors.at(-1)).toBeNull();
  await expect(history.getByRole("alert")).toHaveCount(0);
  await expect(history.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await expect(history.locator("summary").filter({ hasText: secondId })).toContainText("Reversed");
});
