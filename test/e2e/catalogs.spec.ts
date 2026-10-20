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
      await page.screenshot({
        path: info.outputPath(`synthetic-${locale}-${name}.png`),
        fullPage: name !== "publication",
      });
    }
    await capture("changes");
    await page.getByRole("button", { name: c.coverage, exact: true }).click();
    await expect(
      page.getByText("Fictional sounds · fictional-sounds", { exact: true }),
    ).toBeVisible();
    await capture("coverage");
    await page.getByRole("button", { name: c.mappings, exact: true }).click();
    await expect(page.getByLabel(c.candidateEntity, { exact: true })).toBeVisible();
    await capture("mappings");
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
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption("ats");
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
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await next;
  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(
    page.getByText("Fictional sounds · fictional-sounds", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Translations", exact: true }).click();
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
  await page.getByRole("button", { name: "Start import", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`operation=${operationId}`));
  ready = true;
  await page.reload();
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Candidate review", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Mappings", exact: true }).click();
  await expect(page.getByText(/Missing source, map or candidates/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record reviewed mapping", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Explicit canonical candidate", { exact: true }).selectOption(entityId);
  await page.getByLabel("Review reason", { exact: true }).fill("Fictional evidence reviewed");
  await page.getByRole("button", { name: "Record reviewed mapping", exact: true }).click();
  await expect.poll(() => submitted).toBe(1);
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
  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(
    page.getByText("Catalog data could not be read. Check access and refresh.", { exact: true }),
  ).toBeVisible();
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
