import type { Locator, Page } from "@playwright/test";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import {
  artifactId,
  candidateId,
  catalogId,
  catalogLanguage,
  entityId,
  envelope,
  list,
  mockCatalogs,
  operationId,
  regionId,
  revision,
} from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";

test("selector helpers inside an enclosing consumer form never submit; explicit parent submit remains available", async ({
  page,
}) => {
  await mockCatalogs(page, false);
  let failSearch = false;
  await page.route("**/api/v1/catalogs/entities?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("kind") !== "city") return route.fallback();
    if (failSearch)
      return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
    return route.fulfill({
      json: list(
        params.has("cursor")
          ? []
          : [
              {
                id: entityId,
                revisionId: catalogId,
                game: "ets2",
                kind: "city",
                mapNamespace: "base",
                display: {
                  entityId,
                  label: "Fictional city",
                  requestedLocale: "en",
                  renderedLocale: "en",
                  englishFallback: false,
                  retired: false,
                },
                relatedEntityIds: [regionId],
              },
            ],
        params.has("cursor") ? null : "synthetic-selector-next",
      ),
    });
  });
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  const search = page.getByRole("searchbox", { name: "Search Cities", exact: true });
  await expect(page.getByRole("combobox", { name: "Cities", exact: true })).toBeEnabled();
  // Reparent only in this browser fixture: native form ownership is the integration contract.
  await search.evaluate((input) => {
    const selector = input.closest(".catalog-selector");
    if (!selector) throw new Error("SYNTHETIC_SELECTOR_MISSING");
    const form = document.createElement("form"),
      counter = document.createElement("output"),
      submit = document.createElement("button");
    form.setAttribute("aria-label", "Synthetic consumer form");
    counter.setAttribute("aria-label", "Synthetic parent submissions");
    counter.value = "0";
    submit.type = "submit";
    submit.textContent = "Submit synthetic parent";
    selector.replaceWith(form);
    form.append(selector, submit, counter);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      counter.value = String(Number(counter.value) + 1);
    });
  });
  const parent = page.getByRole("form", { name: "Synthetic consumer form", exact: true }),
    counter = page.getByLabel("Synthetic parent submissions", { exact: true });
  await search.press("Enter");
  await expect(counter).toHaveText("0");
  for (const composition of [
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ]) {
    expect(
      await search.evaluate((input, { isComposing, keyCode }) => {
        const event = new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing,
        });
        Object.defineProperty(event, "keyCode", { value: keyCode });
        return input.dispatchEvent(event);
      }, composition),
    ).toBe(true);
  }
  const next = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("cursor") === "synthetic-selector-next",
  );
  await parent.getByRole("button", { name: "Load more", exact: true }).click();
  await next;
  await expect(parent.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  await expect(counter).toHaveText("0");
  await parent.getByRole("combobox", { name: "Cities", exact: true }).selectOption(entityId);
  await expect(
    parent.getByText("Selected canonical entity and revision", { exact: true }),
  ).toBeVisible();
  await parent.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(counter).toHaveText("0");
  failSearch = true;
  await search.fill("failure");
  await expect(parent.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  failSearch = false;
  await parent.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(parent.getByRole("combobox", { name: "Cities", exact: true })).toBeEnabled();
  await expect(counter).toHaveText("0");
  await parent.getByRole("button", { name: "Submit synthetic parent", exact: true }).click();
  await expect(counter).toHaveText("1");
});

for (const locale of ["en", "ru"] as const) {
  test(`synthetic ${locale} staff review renders changes, coverage, mappings and publication confirmation`, async ({
    page,
  }, info) => {
    const c = catalogTranslations[locale];
    await mockCatalogs(page);
    await page.route("**/mapping-issues?*", (route) =>
      route.fulfill({
        json: list([
          {
            id: regionId,
            provider: "synthetic",
            mapNamespace: "base",
            sourceId: "fictional-source",
            sourceLocale: "en",
            reasonCode: "ambiguous_source",
            candidateEntityIds: [entityId],
          },
        ]),
      }),
    );
    await page.goto(`/account/catalogs?candidate=${candidateId}`);
    await catalogLanguage(page, locale);
    await expect(page.getByRole("heading", { name: c.reviewTitle, exact: true })).toBeVisible();
    await expect(page.locator('a[aria-current="page"][href="/account"]')).toHaveCount(0);
    await expect(page.getByText("Synthetic reviewed build", { exact: true })).toBeVisible();
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()?.width ?? 0,
      );
      await page.screenshot({
        path: info.outputPath(`synthetic-${locale}-${name}.png`),
        fullPage: name !== "publication",
      });
    }
    await capture("changes");
    await page.getByRole("tab", { name: c.coverage, exact: true }).click();
    await expect(page.getByRole("tab", { name: c.coverage, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("rowheader", { name: "Fictional sounds · fictional-sounds", exact: true }),
    ).toBeVisible();
    await capture("coverage");
    await page.getByRole("tab", { name: c.mappings, exact: true }).click();
    const mapping = page.getByRole("row", { name: /fictional-source/ });
    await expect(mapping.getByText(c.needsDecision, { exact: true })).toBeVisible();
    await expect(mapping.getByRole("button", { name: c.resolveOpen, exact: true })).toBeVisible();
    await capture("mappings");
    await page.getByRole("tab", { name: c.translations, exact: true }).click();
    await expect(page.getByText(c.translationHelp, { exact: true })).toBeVisible();
    await capture("translations");
    await page.getByRole("button", { name: c.publish, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture("publication");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("published selectors preserve canonical IDs across locale, filter region and expose incompatible history", async ({
  page,
}, info) => {
  await mockCatalogs(page, false);
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Game catalogs", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Cities", exact: true }).selectOption(entityId);
  await expect(
    page.getByText("Selected canonical entity and revision", { exact: true }),
  ).toBeVisible();
  await catalogLanguage(page, "ru");
  await expect(
    page.getByText("Fictional city · Показано на английском", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Города", exact: true })).toHaveValue(entityId);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath("synthetic-catalog-fallback.png"),
    fullPage: true,
  });
  await catalogLanguage(page);
  const filtered = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get("regionId") === regionId,
  );
  await page.getByRole("combobox", { name: "Region filter", exact: true }).selectOption(regionId);
  await filtered;
  await expect(page.getByRole("heading", { name: "Upload and import" })).toHaveCount(0);
  await page
    .getByRole("group", { name: "Game", exact: true })
    .getByRole("button", { name: "ATS", exact: true })
    .click();
  await expect(page.getByText(/Historical or incompatible selection/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Cities", exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("synthetic-catalog-history.png"), fullPage: true });
});
test("candidate review has bounded pages, coverage and translations; stale publication needs fresh confirmation", async ({
  page,
}) => {
  await mockCatalogs(page);
  let posts = 0;
  await page.route("**/publication", async (route) => {
    posts++;
    expect(route.request().headers()["if-match"]).toBe('"v1"');
    expect(route.request().postDataJSON()).toMatchObject({ expectedPublicationVersion: 2 });
    await route.fulfill({ status: 409, json: { error: { code: "PRIVATE_SENTINEL" } } });
  });
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Candidate review", exact: true })).toBeVisible();
  await expect(page.getByText("Fictional old city", { exact: false })).toBeVisible();
  const next = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get("cursor") === "synthetic-next",
  );
  await page
    .getByRole("region", { name: "Candidate review", exact: true })
    .getByRole("button", { name: "Load more", exact: true })
    .click();
  await next;
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(
    page.getByRole("rowheader", { name: "Fictional sounds · fictional-sounds", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Translations", exact: true }).click();
  await expect(page.getByText(/not a complete translation queue/)).toBeVisible();
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review publication", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Review reason", { exact: true }).fill("Fictional reviewed candidate");
  await dialog.getByRole("button", { name: "Confirm publication", exact: true }).click();
  await expect(page.getByText(/Review changed or publication moved/)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review publication", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});
test("upload/import uses actual command shapes, recovers status on reload and replays uncertain upload key", async ({
  page,
}) => {
  await mockCatalogs(page);
  const keys: string[] = [];
  let ready = false;
  await page.route("**/admin/catalog-import-artifacts", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    await route.fulfill(
      keys.length === 1
        ? { status: 502, json: { error: { code: "PRIVATE_SENTINEL" } } }
        : {
            status: 202,
            json: envelope({
              id: artifactId,
              state: "ready",
              sha256: "a".repeat(64),
              byteLength: 2,
            }),
          },
    );
  });
  await page.route("**/admin/catalog-imports", (route) =>
    route.fulfill({
      status: 202,
      json: envelope({ id: operationId, state: "processing", resultId: null, failureCode: null }),
    }),
  );
  await page.route(`**/operations/${operationId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: operationId,
        state: ready ? "completed" : "processing",
        resultId: ready ? candidateId : null,
        failureCode: null,
      }),
    }),
  );
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  const progress = page.getByRole("list", { name: "Import progress", exact: true });
  await expect(progress.getByRole("listitem")).toHaveText([
    /Uploaded: not started$/,
    /Imported: not started$/,
    /Ready for review: not started$/,
  ]);
  await page.getByLabel("Normalized JSON artifact", { exact: true }).setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await page.getByRole("button", { name: "Upload artifact", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("uncertain");
  await page.getByRole("button", { name: "Upload artifact", exact: true }).click();
  await expect(page.getByText("Artifact stored", { exact: true })).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  await expect(progress.getByRole("listitem")).toHaveText([
    /Uploaded: done$/,
    /Imported: current step$/,
    /Ready for review: not started$/,
  ]);
  await expect(page.getByText("a".repeat(64), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start import", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`operation=${operationId}`));
  await expect(progress.getByRole("listitem").nth(1)).toHaveText(/Imported: current step$/);
  ready = true;
  await page.reload();
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Candidate review", exact: true })).toBeVisible();
  await expect(progress.getByRole("listitem")).toHaveText([
    /Uploaded: done$/,
    /Imported: done$/,
    /Ready for review: done$/,
  ]);
  await expect(page.getByText("Import completed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    "synthetic.json",
  );
});
test("mapping resolution submits only explicit candidate and required reason; missing context asks for reimport", async ({
  page,
}) => {
  await mockCatalogs(page);
  let submitted = 0;
  const issue = {
    id: regionId,
    provider: "synthetic",
    mapNamespace: "base",
    sourceId: "fictional-source",
    sourceLocale: "en",
    reasonCode: "ambiguous_source",
    candidateEntityIds: [entityId],
  };
  await page.route("**/mapping-issues?*", (route) =>
    route.fulfill({
      json: list([issue, { ...issue, id: catalogId, sourceId: null, candidateEntityIds: [] }]),
    }),
  );
  await page.route("**/admin/catalog-mappings", async (route) => {
    submitted++;
    expect(route.request().postDataJSON()).toEqual({
      catalogRevisionId: candidateId,
      provider: "synthetic",
      game: "ets2",
      mapNamespace: "base",
      sourceId: "fictional-source",
      entityId,
      reason: "Fictional evidence reviewed",
    });
    await route.fulfill({ status: 201, json: envelope({ id: regionId, version: 2 }) });
  });
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page);
  await page.getByRole("tab", { name: "Mappings", exact: true }).click();
  await expect(page.getByText(/Missing source, map or candidates/)).toBeVisible();
  await expect(page.getByText("Reimport required", { exact: true })).toHaveCount(1);
  const resolve = page.getByRole("button", { name: "Resolve…", exact: true });
  await expect(resolve).toHaveCount(1);
  await resolve.click();
  let dialog = page.getByRole("dialog", { name: "Resolve mapping", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(resolve).toBeFocused();
  await resolve.click();
  dialog = page.getByRole("dialog", { name: "Resolve mapping", exact: true });
  await expect(dialog).toHaveAccessibleDescription(/fictional-source/);
  const record = dialog.getByRole("button", { name: "Record reviewed mapping", exact: true });
  await expect(record).toBeDisabled();
  await dialog.getByRole("radio", { name: `Fictional city · ${entityId}`, exact: true }).check();
  await expect(record).toBeDisabled();
  await dialog.getByLabel("Review reason", { exact: true }).fill("Fictional evidence reviewed");
  await record.click();
  await expect.poll(() => submitted).toBe(1);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({
      hasText: "Mapping recorded. Candidate review has been refreshed.",
    }),
  ).toBeVisible();
});
test("anonymous and revoked catalog sessions cannot retain private catalog content", async ({
  page,
}) => {
  await mockCatalogs(page);
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Candidate review", exact: true })).toBeVisible();
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "PRIVATE_SENTINEL" } } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate review", exact: true })).toHaveCount(0);
});

test("expired operations and partial review failures preserve the available manifest with safe recovery", async ({
  page,
}) => {
  await mockCatalogs(page);
  await page.route(`**/operations/${operationId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: operationId,
        state: "failed",
        resultId: null,
        failureCode: "artifact_expired",
      }),
    }),
  );
  await page.route("**/coverage?*", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } }),
  );
  await page.goto(`/account/catalogs?operation=${operationId}&candidate=${candidateId}`);
  await catalogLanguage(page);
  await expect(
    page.getByText("Artifact expired. Upload a reviewed artifact again.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const failure = page.getByRole("tabpanel").getByRole("alert");
  await expect(
    failure.getByText("Catalog data could not be read. Check access and refresh.", { exact: true }),
  ).toBeVisible();
  await expect(failure.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic reviewed build", { exact: true })).toBeVisible();
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});

test("obsolete search responses cannot replace the effective localized filter", async ({
  page,
}) => {
  await mockCatalogs(page, false);
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/catalogs/entities?*", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search !== "old") return route.fallback();
    await delayed;
    await route.fulfill({ json: list([]) }).catch(() => {});
  });
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  const search = page.getByRole("searchbox", { name: "Search Cities", exact: true });
  const old = page.waitForRequest((r) => new URL(r.url()).searchParams.get("search") === "old");
  await search.fill("old");
  await old;
  await search.fill("absent");
  await expect(page.getByText("No matching active values.", { exact: true })).toBeVisible();
  release();
  await expect(
    page.getByRole("combobox", { name: "Cities", exact: true }).locator("option"),
  ).toHaveCount(1);
});

const box = async (target: Locator) => {
  const value = await target.boundingBox();
  if (!value) throw new Error("SYNTHETIC_TARGET_HIDDEN");
  return value;
};
const candidateRegion = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("region", { name: catalogTranslations[locale].reviewTitle, exact: true });
const revisionsRegion = (page: Page, game = "ETS2") =>
  page.getByRole("region", { name: `${game} revisions`, exact: true });
// With a mobile viewport an overflowing page widens innerWidth, so compare with the viewport.
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
}
async function openReview(page: Page, locale: "en" | "ru" = "en") {
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page, locale);
  await expect(
    candidateRegion(page, locale).getByText("Synthetic reviewed build", { exact: true }),
  ).toBeVisible();
}
const mappingIssue = {
  id: regionId,
  provider: "synthetic",
  mapNamespace: "base",
  sourceId: "fictional-source",
  sourceLocale: "en",
  reasonCode: "ambiguous_source",
  candidateEntityIds: [entityId],
};

for (const locale of ["en", "ru"] as const)
  test(`${locale} first screen shows the game switch, candidate summary, conditions and review tabs`, async ({
    page,
  }, info) => {
    const c = catalogTranslations[locale];
    await mockCatalogs(page);
    await openReview(page, locale);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const candidate = candidateRegion(page, locale),
      revisions = page.getByRole("region", {
        name: c.revisionsTitle.replace("{{game}}", "ETS2"),
        exact: true,
      }),
      upload = page.getByRole("region", { name: c.importTitle, exact: true }),
      search = page.getByRole("region", { name: c.searchTitle, exact: true });
    if (info.project.name === "desktop-chromium") {
      for (const target of [
        page.getByRole("group", { name: c.game, exact: true }),
        candidate.getByRole("heading", { name: c.reviewTitle, exact: true }),
        candidate.getByRole("group", { name: c.summaryLabel, exact: true }),
        candidate.getByRole("list", { name: c.conditionsLabel, exact: true }),
        candidate.getByRole("tablist", { name: c.sectionsLabel, exact: true }),
      ]) {
        const { y, height } = await box(target);
        expect(y + height).toBeLessThanOrEqual(800);
      }
      const side = await box(revisions),
        main = await box(candidate);
      expect(main.x).toBeGreaterThan(side.x);
      expect(Math.abs(main.y - side.y)).toBeLessThanOrEqual(2);
    } else {
      const tops: number[] = [];
      for (const region of [revisions, upload, candidate, search]) tops.push((await box(region)).y);
      for (let index = 1; index < tops.length; index++)
        expect(tops[index]).toBeGreaterThan(tops[index - 1] ?? Number.POSITIVE_INFINITY);
    }
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`catalog-review-${locale}.png`) });
  });

test("review tabs follow arrow, Home and End keys and show returned counts", async ({ page }) => {
  await mockCatalogs(page, true, { review: { missingPacks: 1, mappingIssues: 2 } });
  await openReview(page);
  const tabs = candidateRegion(page).getByRole("tablist", { name: "Review sections", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText([
    "Changes · 4",
    /^Coverage · 1/,
    "Mappings · 2",
    "Translations",
  ]);
  const changes = tabs.getByRole("tab", { name: "Changes · 4", exact: true }),
    coverage = tabs.getByRole("tab", { name: "Coverage · 1", exact: true });
  await changes.focus();
  const read = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/coverage") && url.searchParams.get("reviewVersion") === "1";
  });
  await page.keyboard.press("ArrowRight");
  await expect(coverage).toBeFocused();
  await expect(coverage).toHaveAttribute("aria-selected", "true");
  await read;
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Translations", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(changes).toBeFocused();
  await expect(changes).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
});

const publishButton = (page: Page) =>
  page.getByRole("button", { name: "Review publication", exact: true });
const conditionItems = (page: Page) =>
  page.getByRole("list", { name: "Publication conditions", exact: true }).getByRole("listitem");

test("publication is available only when every returned condition is met", async ({ page }) => {
  await mockCatalogs(page);
  await openReview(page);
  await expect(conditionItems(page)).toHaveText([
    /✓ Coverage complete$/,
    /✓ English labels complete$/,
    /✓ Exact-artifact source review: Approved$/,
    /✓ No unresolved mappings$/,
  ]);
  await expect(publishButton(page)).toBeEnabled();
  await expect(publishButton(page)).toHaveAccessibleDescription(
    "All conditions are met. Publication requires confirmation and a reason.",
  );
});

test("blocked publication names each unmet condition in a fixed order", async ({ page }) => {
  await mockCatalogs(page, true, {
    review: { mappingIssues: 2 },
    candidate: { englishLabelsComplete: false },
  });
  await openReview(page);
  await expect(conditionItems(page)).toHaveText([
    /✓ Coverage complete$/,
    /✕ English labels incomplete$/,
    /✓ Exact-artifact source review: Approved$/,
    /✕ Unresolved mappings: 2$/,
  ]);
  await expect(publishButton(page)).toBeDisabled();
  await expect(publishButton(page)).toHaveAccessibleDescription(
    "Unavailable: English labels incomplete; Unresolved mappings: 2.",
  );
});

test("a published candidate cannot be published again", async ({ page }) => {
  await mockCatalogs(page, true, { candidate: { state: "published" } });
  await openReview(page);
  await expect(candidateRegion(page).getByText("Published", { exact: true })).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
  await expect(publishButton(page)).toHaveAccessibleDescription(/Candidate is Published/);
  await expect(revisionsRegion(page).getByText("Under review", { exact: true })).toHaveCount(0);
});

test("changes table names entities, field transitions and type; the filter sends the canonical kind", async ({
  page,
}) => {
  await mockCatalogs(page);
  await openReview(page);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("rowheader", { name: /^Fictional city/ })).toBeVisible();
  const row = panel
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: /^Fictional city/ }) });
  await expect(row.getByText(entityId, { exact: true })).toBeVisible();
  await expect(row.getByText("Fictional old city → Fictional city", { exact: true })).toBeVisible();
  await expect(row.getByText("false → true", { exact: true })).toBeVisible();
  await expect(row.getByText("~ Changed", { exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Cities", exact: true })).toBeVisible();
  await expect(panel.getByText(/Retired entities are never deleted/)).toBeVisible();
  const retired = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("changeKind") === "retired",
  );
  await panel.getByLabel("Change type", { exact: true }).selectOption("retired");
  await retired;
  await noOverflow(page);
});

test("coverage lists packs as row headers with contribution, reasons and a failed state", async ({
  page,
}) => {
  await mockCatalogs(page, true, {
    review: { failedPacks: 1 },
    candidate: { coverageComplete: false },
  });
  await page.route("**/coverage?*", (route) =>
    route.fulfill({
      json: list([
        {
          packId: "base",
          title: "Fictional base",
          state: "validated",
          contributionKinds: ["city"],
          provenance: [],
          reasonCodes: [],
        },
        {
          packId: "fictional-sounds",
          title: "Fictional sounds",
          state: "non_contributing",
          contributionKinds: [],
          provenance: [],
          reasonCodes: ["no_catalog_facts"],
        },
        {
          packId: "fictional-broken",
          title: "Fictional broken pack",
          state: "failed",
          contributionKinds: ["cargo"],
          provenance: [],
          reasonCodes: ["synthetic_parse_failure"],
        },
      ]),
    }),
  );
  await openReview(page);
  await expect(conditionItems(page).first()).toHaveText(
    /✕ Coverage incomplete: missing or failed packs: 1$/,
  );
  await page.getByRole("tab", { name: "Coverage · 1", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  for (const name of ["Fictional base · base", "Fictional sounds · fictional-sounds"])
    await expect(panel.getByRole("rowheader", { name, exact: true })).toBeVisible();
  const failed = panel.getByRole("row").filter({
    has: page.getByRole("rowheader", {
      name: "Fictional broken pack · fictional-broken",
      exact: true,
    }),
  });
  await expect(failed.getByText("Failed", { exact: true })).toBeVisible();
  await expect(failed.getByText("synthetic_parse_failure", { exact: true })).toBeVisible();
  await expect(panel.getByText(/base game plus all official DLCs/)).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
});

test("translations show only returned labels with an explicit Russian fallback marker", async ({
  page,
}) => {
  await mockCatalogs(page);
  await page.route("**/diff?*", (route) =>
    route.fulfill({
      json: list([
        {
          entityId,
          kind: "city",
          changeKind: "added",
          fields: [
            { field: "label_en", before: null, after: "Fictional added city" },
            { field: "label_ru", before: null, after: null },
          ],
          reasonCodes: [],
        },
        {
          entityId: regionId,
          kind: "region",
          changeKind: "changed",
          fields: [{ field: "cargo_unit_mass_kg", before: 1000, after: 1200 }],
          reasonCodes: [],
        },
      ]),
    }),
  );
  await openReview(page);
  await page.getByRole("tab", { name: "Translations", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("rowheader")).toHaveCount(1);
  const row = panel
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: /^Fictional added city/ }) });
  await expect(row.getByRole("cell", { name: "Fictional added city", exact: true })).toBeVisible();
  await expect(row.getByText("English fallback", { exact: true })).toBeVisible();
  await expect(row.getByText("+ Added", { exact: true })).toBeVisible();
  await expect(panel.getByText(/not a complete translation queue/)).toBeVisible();
});

test("revisions list the open candidate, current and replaced; another game shows its empty state", async ({
  page,
}) => {
  const older = "61000000-0000-4000-8000-000000000021";
  await mockCatalogs(page, true, {
    revisions: {
      ets2: [revision(), { ...revision(older), createdAt: "2026-09-01T10:00:00.000Z" }],
    },
  });
  await openReview(page);
  const rows = revisionsRegion(page).getByRole("row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText(candidateId);
  await expect(rows.nth(1)).toContainText("Under review");
  await expect(rows.nth(2)).toContainText(catalogId);
  await expect(rows.nth(2)).toContainText("Current");
  await expect(rows.nth(3)).toContainText(older);
  await expect(rows.nth(3)).toContainText("Replaced");
  await expect(page.getByText("Published revision in use", { exact: true })).toBeVisible();
  await page
    .getByRole("group", { name: "Game", exact: true })
    .getByRole("button", { name: "ATS", exact: true })
    .click();
  const ats = revisionsRegion(page, "ATS");
  await expect(ats.getByText("No published catalog for this game.", { exact: true })).toBeVisible();
  await expect(ats.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("No published catalog", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/game=ats/);
});

test("revision discovery failure offers refresh and disables published search", async ({
  page,
}) => {
  await mockCatalogs(page, false, { failures: { "/catalogs/revisions": 503 } });
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  const alert = revisionsRegion(page).getByRole("alert");
  await expect(
    alert.getByText("Catalog data could not be read. Check access and refresh.", { exact: true }),
  ).toBeVisible();
  await expect(alert.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Published revision", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Published revision in use", { exact: true })).toHaveCount(0);
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});

test("revision discovery shows a loading status until the response arrives", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockCatalogs(page, false, { gate });
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  await expect(revisionsRegion(page).getByRole("status")).toHaveText("Loading catalog…");
  release();
  await expect(revisionsRegion(page).getByRole("rowheader")).toHaveCount(1);
  await expect(revisionsRegion(page).getByRole("status")).toHaveCount(0);
});

test("staff without a candidate see guidance instead of review", async ({ page }) => {
  await mockCatalogs(page);
  await page.goto("/account/catalogs");
  await catalogLanguage(page);
  const empty = page.getByRole("region", { name: "No candidate to review", exact: true });
  await expect(empty.getByText(/Use Recover to reopen/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Candidate review", exact: true })).toHaveCount(0);
  await expect(revisionsRegion(page).getByText("Under review", { exact: true })).toHaveCount(0);
});

test("candidate read failure keeps the page usable with a refresh", async ({ page }) => {
  await mockCatalogs(page, true, {
    failures: { [`/admin/catalog-revisions/${candidateId}`]: 503 },
  });
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page);
  const candidate = candidateRegion(page);
  await expect(candidate.getByRole("alert")).toHaveText(
    "Catalog data could not be read. Check access and refresh.",
  );
  await expect(candidate.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(candidate.getByRole("tablist")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Published catalog search", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});

test("company readers see revisions and search without staff requests", async ({ page }) => {
  const { requests } = await mockCatalogs(page, false);
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page);
  await expect(revisionsRegion(page).getByRole("rowheader")).toHaveCount(1);
  await expect(
    page.getByText("Import and publication require catalog management permission.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const name of ["Upload and import", "Candidate review", "No candidate to review"])
    await expect(page.getByRole("region", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Cities", exact: true })).toBeEnabled();
  expect(requests.filter((url) => url.pathname.startsWith("/api/v1/admin/"))).toEqual([]);
});

test("members without company access see only the boundary notice", async ({ page }) => {
  const { requests } = await mockCatalogs(page, false, { capabilities: ["events.respond"] });
  await page.goto(`/account/catalogs?candidate=${candidateId}`);
  await catalogLanguage(page, "ru");
  await expect(page.getByText("У вас нет доступа к каталогам игр.", { exact: true })).toBeVisible();
  await catalogLanguage(page);
  await expect(
    page.getByText("You do not have access to game catalogs.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Game catalogs" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Game", exact: true })).toHaveCount(0);
  expect(
    requests.filter((url) => /^\/api\/v1\/(catalogs\/|admin\/catalog)/.test(url.pathname)),
  ).toEqual([]);
});

test("a revoked session removes review and published catalog content", async ({ page }) => {
  await mockCatalogs(page);
  await openReview(page);
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "PRIVATE_SENTINEL" } } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  for (const text of ["Synthetic reviewed build", candidateId, catalogId, "ETS2 revisions"])
    await expect(page.getByText(text)).toHaveCount(0);
});

test("catalog controls keep compact fine-pointer metrics and 40px touch targets", async ({
  page,
}, info) => {
  await mockCatalogs(page, true, { review: { mappingIssues: 1 } });
  await page.route("**/mapping-issues?*", (route) => route.fulfill({ json: list([mappingIssue]) }));
  await openReview(page);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(coarse).toBe(info.project.name === "mobile-chromium");
  const expectTarget = async (target: Locator, fine: number) => {
    const { height } = await box(target);
    if (coarse) expect(height).toBeGreaterThanOrEqual(40);
    else expect(Math.abs(height - fine)).toBeLessThanOrEqual(0.5);
  };
  const candidate = candidateRegion(page);
  for (const button of await page
    .getByRole("group", { name: "Game", exact: true })
    .getByRole("button")
    .all())
    await expectTarget(button, 24);
  for (const tab of await candidate.getByRole("tab").all()) await expectTarget(tab, 32);
  await expectTarget(candidate.getByRole("button", { name: "Refresh", exact: true }), 24);
  await expectTarget(candidate.getByLabel("Change type", { exact: true }), 24);
  await expectTarget(publishButton(page), 30);
  await expectTarget(page.getByRole("button", { name: "Upload artifact", exact: true }), 30);
  await expectTarget(page.getByLabel("Normalized JSON artifact", { exact: true }), 32);
  const changes = candidate.getByRole("region", { name: "Changes", exact: true });
  await changes.focus();
  await expect(changes).toBeFocused();
  await candidate.getByRole("tab", { name: "Mappings · 1", exact: true }).click();
  const mappings = candidate.getByRole("region", { name: "Mappings", exact: true });
  await mappings.focus();
  await expect(mappings).toBeFocused();
  const resolve = candidate.getByRole("button", { name: "Resolve…", exact: true });
  await expectTarget(resolve, 24);
  await resolve.click();
  const radio = page
    .getByRole("dialog", { name: "Resolve mapping", exact: true })
    .getByRole("radio", { name: `Fictional city · ${entityId}`, exact: true });
  const row = radio.locator("xpath=ancestor::label[1]");
  if (coarse) expect((await box(row)).height).toBeGreaterThanOrEqual(40);
  else expect((await box(row)).height).toBeGreaterThanOrEqual(29.5);
  await page.keyboard.press("Escape");
  await noOverflow(page);
});

test("publication confirmation names the exact game, candidate and pointer and needs a reason", async ({
  page,
}) => {
  await mockCatalogs(page);
  await openReview(page);
  await publishButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Publish the ETS2 catalog?", exact: true });
  await expect(dialog).toHaveAccessibleDescription(
    "Publication switches the current revision for the whole company. Historical revisions remain readable.",
  );
  await expect(dialog.getByRole("listitem")).toHaveText([
    "ETS2 · build Synthetic reviewed build",
    `Candidate ${candidateId} · version 1`,
    "Expected publication pointer version: 2",
  ]);
  const confirm = dialog.getByRole("button", { name: "Confirm publication", exact: true }),
    reason = dialog.getByLabel("Review reason", { exact: true });
  await expect(confirm).toBeDisabled();
  await reason.fill("   ");
  await expect(confirm).toBeDisabled();
  await reason.fill("Fictional reviewed candidate");
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(publishButton(page)).toBeFocused();
});
