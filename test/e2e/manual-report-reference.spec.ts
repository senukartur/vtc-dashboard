import type { Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import {
  catalogItem,
  catalogLanguage,
  catalogList,
  chooseCatalogRow,
  depotRow,
  entityId,
  envelope,
} from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { completeForm, example, id, mockTrips } from "./support/trip-ui.ts";

const companyId = "54000000-0000-4000-8000-000000000005";
const otherCompanyId = "54000000-0000-4000-8000-000000000006";
const secondCityId = "54000000-0000-4000-8000-000000000021";
const thirdCityId = "54000000-0000-4000-8000-000000000022";
const draftId = "51000000-0000-4000-8000-000000000010";
const secondDraftId = "51000000-0000-4000-8000-000000000011";
const draftPath = "/api/v1/me/manual-drafts";
const detailPath = `/api/v1/trips/${id}`;

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test(
  "dated report validates DST gaps, future and equal times and bounded damage before writing",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const self = accountFixture("en");
    self.data.preferences.displayTimezone = "Europe/Warsaw";
    await page.route("**/api/v1/me", (route) => route.fulfill({ json: self }));
    let body: { fields?: Record<string, unknown> } | undefined;
    await page.route("**/api/v1/manual-reports", (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: example("submitManualReport:dated") });
    });
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await completeForm(page);
    const start = page.getByLabel("Trip start", { exact: true });
    const end = page.getByLabel("Trip completion", { exact: true });
    const damage = page.getByLabel("Cargo damage (%) (optional)", { exact: true });
    const submit = page.getByRole("button", { name: "Submit for review", exact: true });

    await start.fill("2025-03-30T02:30");
    await expect(start).toHaveAttribute("aria-invalid", "true");
    await expect(start).toHaveAccessibleDescription(/Europe\/Warsaw.*exists/);
    await expect(page.getByRole("alert")).toContainText("exists in the displayed time zone");
    await expect(submit).toBeDisabled();

    await start.fill("2025-10-26T02:30");
    await end.fill("2099-01-01T01:30");
    await expect(end).toHaveAccessibleDescription(/at or before now/);
    await expect(submit).toBeDisabled();
    await end.fill("2025-10-26T02:30");
    await expect(end).toHaveAccessibleDescription(/completion time after the start/);
    await expect(submit).toBeDisabled();

    await end.fill("2025-10-26T03:00");
    await damage.fill("100,1");
    await expect(damage).toHaveAccessibleDescription("Enter a number from 0 to 100.");
    await expect(page.getByRole("alert")).toContainText("Enter a number from 0 to 100.");
    await expect(submit).toBeDisabled();
    await damage.fill("2,75");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await submit.click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect
      .poll(() => body?.fields)
      .toMatchObject({
        startedAt: "2025-10-26T00:30:00.000Z",
        completedAt: "2025-10-26T02:00:00.000Z",
        cargoDamagePercent: 2.75,
      });
    expect(body?.fields).not.toHaveProperty("originCompanyId");
    expect(body?.fields).not.toHaveProperty("destinationCompanyId");
  },
);

test(
  "company options use visible same-game depots, paginate and ignore obsolete eligibility",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const names: Record<string, string> = {
      [entityId]: "Fictional city",
      [secondCityId]: "Fictional Second City",
      [thirdCityId]: "Fictional Third City",
    };
    await page.route(/\/api\/v1\/catalogs\/cities(?:\/|[?])/, (route) => {
      const url = new URL(route.request().url());
      const selected = url.pathname.split("/").at(-1);
      const item = (city: string) => catalogItem(city, names[city] ?? "Fictional city");
      return route.fulfill({
        json:
          selected && selected in names
            ? envelope(item(selected))
            : catalogList(Object.keys(names).map(item)),
      });
    });
    let releaseObsolete = () => {};
    let obsoleteStarted = false;
    const waitForObsolete = new Promise<void>((resolve) => {
      releaseObsolete = resolve;
    });
    const depotIds = [
      "55000000-0000-4000-8000-000000000001",
      "55000000-0000-4000-8000-000000000002",
      "55000000-0000-4000-8000-000000000003",
    ] as const;
    const depotReads: URLSearchParams[] = [];
    await page.route("**/api/v1/catalogs/depots?*", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      depotReads.push(query);
      const city = query.get("cityId") ?? "";
      const selected = query.get("companyId");
      const depot = (company: string, name: string, index: 0 | 1 | 2) =>
        depotRow(
          depotIds[index],
          { id: company, name },
          { id: city, name: names[city] ?? "Fictional city" },
        );
      if (city === secondCityId && selected) {
        obsoleteStarted = true;
        await waitForObsolete;
        await route.fulfill({ json: catalogList([]) }).catch(() => {});
        return;
      }
      if (city === secondCityId) return route.fulfill({ json: catalogList([]) });
      const allowed = depot(companyId, "Fictional Freight", 0);
      if (selected)
        return route.fulfill({ json: catalogList(selected === companyId ? [allowed] : []) });
      if (query.has("cursor"))
        return route.fulfill({ json: catalogList([depot(otherCompanyId, "Fictional Bulk", 1)]) });
      return route.fulfill({
        json: catalogList(
          [allowed, { ...depot(otherCompanyId, "Fictional Hidden", 2), hidden: true }],
          city === entityId ? "synthetic-depot-cursor" : null,
        ),
      });
    });
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    const origin = page.getByLabel("Origin company (optional)", { exact: true });
    await expect(origin).toBeDisabled();
    await expect(page.getByText("Select a city to see its companies.")).toHaveCount(2);
    await chooseCatalogRow(page, "Origin city", "Fictional city");
    await expect(origin.getByRole("option", { name: "Fictional Freight" })).toHaveCount(1);
    await expect(origin.getByRole("option", { name: "Fictional Hidden" })).toHaveCount(0);
    await page.getByRole("button", { name: "Load more companies", exact: true }).click();
    await expect(origin.getByRole("option", { name: "Fictional Bulk" })).toHaveCount(1);
    await origin.selectOption(companyId);
    const save = page.getByRole("button", { name: "Save draft", exact: true });
    await expect(save).toBeEnabled();

    await chooseCatalogRow(page, "Origin city", "Fictional Second City");
    await expect.poll(() => obsoleteStarted).toBe(true);
    await expect(save).toBeDisabled();
    try {
      await chooseCatalogRow(page, "Origin city", "Fictional Third City");
      await expect(origin).toHaveValue(companyId);
      await expect(save).toBeEnabled();
    } finally {
      releaseObsolete();
    }
    await expect(origin).toHaveValue(companyId);
    await chooseCatalogRow(page, "Origin city", "Fictional Second City");
    await expect(origin).toHaveValue("");
    await expect(page.getByRole("status")).toContainText("The selection was cleared");
    await expect(save).toBeEnabled();
    expect(
      depotReads.every(
        (query) =>
          query.get("game") === "ets2" &&
          query.get("locale") === "en" &&
          !!query.get("cityId") &&
          !query.has("includeHidden"),
      ),
    ).toBe(true);
    expect(depotReads.some((query) => query.get("companyId") === companyId)).toBe(true);
  },
);

test(
  "draft tab renders authorized count and localized rows, then refreshes stale delete and restores focus",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    const draft = example("listMyManualDrafts:editing-only").data.items[0];
    const label = (entityId: string, text: string) => ({
      entityId,
      label: text,
      requestedLocale: "ru",
      renderedLocale: "en",
      englishFallback: true,
      hidden: false,
    });
    draft.fields.origin = { status: "resolved", entityId };
    draft.fields.destination = { status: "resolved", entityId: thirdCityId };
    draft.fields.cargo = {
      status: "unresolved",
      label: "Fictional crates",
      reasonCode: "not_listed",
      locale: "en",
      context: null,
    };
    draft.labels = {
      origin: label(entityId, "Fictional Northern Freight Terminal"),
      destination: label(thirdCityId, "Fictional Southern Industrial District"),
      cargo: null,
    };
    let version = 1;
    let deleted = false;
    let releaseRefresh = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const requests: {
      version?: string;
      key?: string;
      csrf?: string;
      contentType?: string;
      body: string | null;
    }[] = [];
    await page.route("**/api/v1/me/manual-drafts?*", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get("state")).toBe("editing");
      const paged = query.has("cursor");
      if (paged && version === 2 && !deleted) await refreshGate;
      const items = paged ? (deleted ? [] : [{ ...draft, id: secondDraftId, version }]) : [draft];
      return route.fulfill({
        json: envelope({
          items,
          nextCursor: paged || deleted ? null : "synthetic-page-2",
          editingCount: deleted ? 37 : 38,
        }),
      });
    });
    await page.route(`**${draftPath}/${secondDraftId}`, (route) => {
      const req = route.request();
      expect(req.method()).toBe("DELETE");
      const headers = req.headers();
      requests.push({
        ...(headers["if-match"] ? { version: headers["if-match"] } : {}),
        ...(headers["idempotency-key"] ? { key: headers["idempotency-key"] } : {}),
        ...(headers["x-csrf-token"] ? { csrf: headers["x-csrf-token"] } : {}),
        ...(headers["content-type"] ? { contentType: headers["content-type"] } : {}),
        body: req.postData(),
      });
      if (version === 1) {
        version = 2;
        return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
      }
      deleted = true;
      return route.fulfill({ json: envelope({ id: secondDraftId, version: 3 }) });
    });
    await page.goto("/account/trips");
    await catalogLanguage(page);
    const firstTab = page.getByRole("tab", { name: "My trips", exact: true });
    const draftTab = page.getByRole("tab", { name: "Drafts (38)", exact: true });
    await firstTab.focus();
    await firstTab.press("End");
    await expect(draftTab).toBeFocused();
    await draftTab.press("Enter");
    await expect(page).toHaveURL(/tab=drafts/);
    const region = page.getByRole("region", { name: "Saved drafts" });
    await expect(region).toContainText("Fictional Northern Freight Terminal");
    await expect(region).toContainText("Fictional crates");
    await expect(region.getByRole("link", { name: "Continue draft" })).toHaveAttribute(
      "href",
      `/account/reports/drafts/${draftId}`,
    );
    const tabsFit = () =>
      page.getByRole("tablist").evaluate((strip) => strip.scrollWidth <= strip.clientWidth);
    await expect.poll(tabsFit).toBe(true);
    await capture(page, info, "drafts-en");
    await catalogLanguage(page, "ru");
    await expect(page.getByRole("tab", { name: "Черновики (38)", exact: true })).toBeVisible();
    await expect.poll(tabsFit).toBe(true);
    await capture(page, info, "drafts-ru");
    await catalogLanguage(page);
    await region.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(region.getByRole("link", { name: "Continue draft" })).toHaveAttribute(
      "href",
      `/account/reports/drafts/${secondDraftId}`,
    );

    const trigger = region.getByRole("button", { name: "Delete draft", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Delete this draft?", exact: true });
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(requests).toHaveLength(0);
    await trigger.click();
    await dialog.getByRole("button", { name: "Delete draft", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(region.getByRole("alert")).toContainText("Review it before deleting again");
    try {
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-disabled", "true");
      await trigger.press("Enter");
      await expect(dialog).toHaveCount(0);
      expect(requests).toHaveLength(1);
    } finally {
      releaseRefresh();
    }
    await expect(trigger).toBeEnabled();

    await trigger.click();
    await dialog.getByRole("button", { name: "Delete draft", exact: true }).click();
    await expect(region.getByRole("status")).toContainText("Draft deleted.");
    await expect(page.getByRole("tab", { name: "Drafts (37)", exact: true })).toBeVisible();
    await expect(region.getByRole("heading", { name: "Saved drafts", exact: true })).toBeFocused();
    expect(requests.map(({ version, body, contentType }) => [version, body, contentType])).toEqual([
      ['"v1"', null, undefined],
      ['"v2"', null, undefined],
    ]);
    for (const request of requests) {
      expect(request.key).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
      expect(request.csrf).toBeTruthy();
    }
    expect(requests[0]?.key).not.toBe(requests[1]?.key);
  },
);

test(
  "draft editor deletes with the GET ETag and returns to an empty draft tab",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    let deleted = false;
    const draft = example("listMyManualDrafts:editing-only").data.items[0];
    await page.route("**/api/v1/me/manual-drafts?*", (route) =>
      route.fulfill({
        json: envelope({
          items: deleted ? [] : [draft],
          nextCursor: null,
          editingCount: Number(!deleted),
        }),
      }),
    );
    await page.route(`**${draftPath}/${draftId}`, (route) => {
      const method = route.request().method();
      if (method === "GET")
        return deleted
          ? route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } })
          : route.fulfill({ json: envelope(draft), headers: { ETag: '"v7"' } });
      expect(method).toBe("DELETE");
      expect(route.request().headers()["if-match"]).toBe('"v7"');
      expect(route.request().postData()).toBeNull();
      deleted = true;
      return route.fulfill({ json: envelope({ id: draftId, version: 8 }) });
    });
    await page.goto(`/account/reports/drafts/${draftId}`);
    await catalogLanguage(page);
    await page.getByRole("button", { name: "Delete draft", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\/trips[?]tab=drafts$/);
    await expect(page.getByRole("tab", { name: "Drafts (0)", exact: true })).toBeVisible();
    await expect(page.getByText("You have no saved drafts.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Saved drafts" }).getByRole("status"),
    ).toContainText("Draft deleted.");
  },
);

test(
  "private manual trip localizes reference times, zero damage and company labels at all widths",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    const sample = example("getTrip:dated-private-revision");
    sample.data.summary.id = id;
    sample.data.manualRevision.fields.cargoDamagePercent = 0;
    await page.route(`**${detailPath}`, (route) =>
      route.fulfill({ json: sample, headers: { ETag: '"v3"' } }),
    );
    await page.route(/\/api\/v1\/catalogs\/companies\/[^?]+[?]/, (route) => {
      const url = new URL(route.request().url());
      const requested = url.pathname.split("/").at(-1) ?? "";
      const locale = url.searchParams.get("locale") === "ru" ? "ru" : "en";
      const label = requested === companyId ? "Fictional North Depot" : "Fictional South Depot";
      return route.fulfill({ json: envelope(catalogItem(requested, label, locale)) });
    });
    await page.goto(`/account/trips/${id}`);
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      const heading =
        locale === "en" ? "Driver-reported reference facts" : "Справочные данные водителя";
      const facts = page.getByRole("region", { name: heading, exact: true });
      await expect(facts).toContainText("Fictional North Depot");
      await expect(facts).toContainText("Fictional South Depot");
      await expect(facts).toContainText("0 %");
      await expect(facts.locator("time").first()).toHaveAttribute(
        "datetime",
        "2026-10-20T09:00:00.000Z",
      );
      await expect(facts.locator("time").first()).toContainText("09:00");
      await expect(page.getByText(companyId, { exact: true })).toHaveCount(0);
      await capture(page, info, `private-manual-reference-${locale}`);
    }
  },
);

test(
  "old manual reports omit references and summary and telemetry reads never resolve manual companies",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    let view: "old" | "summary" | "telemetry" = "old";
    let companyReads = 0;
    const older = example("getTrip:extended-manual-revision");
    const summary = { ...older.data.summary, decision: "accepted" };
    await page.route(`**${detailPath}`, (route) =>
      route.fulfill({
        json:
          view === "old"
            ? older
            : view === "summary"
              ? envelope(summary)
              : envelope({
                  ...older.data,
                  summary: { ...summary, sourceKinds: ["ets2telemetry"] },
                  manualRevision: null,
                }),
      }),
    );
    await page.route(/\/api\/v1\/catalogs\/companies\//, (route) => {
      companyReads++;
      return route.abort("failed");
    });
    await page.goto(`/account/trips/${id}`);
    await catalogLanguage(page);
    const facts = page.getByRole("region", { name: "Driver-reported reference facts" });
    await expect(facts.getByText("Not specified", { exact: true })).toHaveCount(5);
    for (const variant of ["summary", "telemetry"] as const) {
      view = variant;
      await page.reload();
      await expect(
        page.getByRole("paragraph").filter({
          hasText:
            view === "summary"
              ? /^Accepted company summary$/
              : /^Private report and review history$/,
        }),
      ).toBeVisible();
      await expect(facts).toHaveCount(0);
    }
    expect(companyReads).toBe(0);
  },
);
