import type { Locator, Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import {
  catalogItem,
  catalogLanguage,
  chooseCatalogRow,
  entityId,
  envelope,
} from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { completeForm, evidenceId, example, id, mockTrips } from "./support/trip-ui.ts";

const text = {
  en: {
    title: "New report",
    form: "Manual report",
    next: "What happens next",
    groups: ["Origin city", "Destination city", "Cargo", "Trailer type"],
    missing: "Before submitting, complete or correct:",
    items: [
      "Origin city",
      "Destination city",
      "Cargo",
      "Trailer type",
      "Cargo mass (kg)",
      "Actual driven distance (m)",
      "A ready completion screenshot",
    ],
    mass: "Cargo mass (kg)",
    massHelp: "Actual shipment mass, not the catalog unit mass.",
    distanceHelp: "Driven distance from the results screen, not the planned route length.",
    eventHelp:
      "Selection or RSVP does not prove attendance. Only staff-confirmed participation can support an event load exception.",
    submit: "Submit for review",
    noTarget: "Create a separate trip",
  },
  ru: {
    title: "Новый отчёт",
    form: "Ручной отчёт",
    next: "Что будет дальше",
    groups: ["Город отправления", "Город назначения", "Груз", "Тип прицепа"],
    missing: "Перед отправкой заполните или исправьте:",
    items: [
      "Город отправления",
      "Город назначения",
      "Груз",
      "Тип прицепа",
      "Масса груза (кг)",
      "Фактический пробег (м)",
      "Готовый скриншот завершения рейса",
    ],
    mass: "Масса груза (кг)",
    massHelp: "Фактическая масса отправки, а не масса единицы груза из каталога.",
    distanceHelp: "Пробег с экрана результатов, а не плановая длина маршрута.",
    eventHelp:
      "Выбор или запись на мероприятие не подтверждают участие. Исключение по грузу требует подтверждения участия сотрудником.",
    submit: "Отправить на проверку",
    noTarget: "Создать отдельный рейс",
  },
} as const;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
/** The new-report page has no loading status left and shows the enabled upload picker. */
async function settled(page: Page) {
  await expect(page.locator("#manual-file")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
}
const missingList = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("list", { name: text[locale].missing, exact: true });
/**
 * Words inside the report page that wrap mid-word (a word whose text range spans several lines).
 * Canonical identifiers (evidence ids, selection pins, trip facts) may break anywhere.
 */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".trip-evidence small, dd")) continue;
      // A hyphen is a normal break opportunity ("staff-confirmed"); letters around it are not.
      for (const match of (node.textContent ?? "").matchAll(/[^\s-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(match[0]);
      }
    }
    return broken;
  });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

for (const locale of ["en", "ru"] as const)
  test(
    `R1 ${locale} compact report form places the aside and fields by width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = text[locale];
      await mockTrips(page);
      await page.goto("/account/reports/new");
      await catalogLanguage(page, locale);
      await settled(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.title);
      const form = page.getByRole("form", { name: s.form, exact: true }),
        aside = page.getByRole("complementary", { name: s.next, exact: true });
      await expect(aside.getByRole("heading", { level: 2 })).toHaveText(s.next);
      await expect(aside.getByRole("listitem")).toHaveCount(4);
      const [origin, destination, cargo] = await Promise.all(
        s.groups.slice(0, 3).map((name) => box(page.getByRole("combobox", { name, exact: true }))),
      );
      const formBox = await box(form),
        asideBox = await box(aside),
        mass = await box(page.locator("#cargoMassKg")),
        distance = await box(page.locator("#actualDistanceM"));
      if (!origin || !destination || !cargo) throw new Error("GROUP_NOT_RENDERED");
      if (info.project.name === "desktop-chromium") {
        expect(asideBox.x).toBeGreaterThanOrEqual(formBox.x + formBox.width);
        expect(Math.abs(asideBox.y - formBox.y)).toBeLessThanOrEqual(1);
      } else expect(asideBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
      const game = await box(page.locator("#manual-game"));
      if (info.project.name === "mobile-chromium") {
        // One-column forms give the game a full row, like every other field.
        expect(Math.abs(game.width - origin.width)).toBeLessThanOrEqual(1);
        expect(destination.y).toBeGreaterThanOrEqual(origin.y + origin.height);
        expect(Math.abs(destination.x - origin.x)).toBeLessThanOrEqual(1);
        expect(distance.y).toBeGreaterThan(mass.y);
      } else {
        expect(Math.abs(destination.y - origin.y)).toBeLessThanOrEqual(1);
        expect(destination.x).toBeGreaterThan(origin.x + origin.width);
        expect(cargo.y).toBeGreaterThan(origin.y);
        expect(Math.abs(distance.y - mass.y)).toBeLessThanOrEqual(1);
      }
      // Russian report copy wraps only between words (trips.css otherwise breaks anywhere).
      expect(await brokenWords(page.locator(".manual-report"))).toEqual([]);
      await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
      await capture(page, info, `manual-report-${locale}`);
    },
  );

test(
  "R1 ru keeps whole words with a 520-540px two-column form",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page, "ru");
    await settled(page);
    const form = page.getByRole("form", { name: text.ru.form, exact: true });
    let width = 0;
    for (let viewport = 540; viewport <= 640 && (width < 520 || width > 540); viewport += 4) {
      await page.setViewportSize({ width: viewport, height: 900 });
      width = await form.evaluate((element) => element.clientWidth);
    }
    expect(width).toBeGreaterThanOrEqual(520);
    expect(width).toBeLessThanOrEqual(540);
    const origin = await box(
        page.getByRole("combobox", { name: "Город отправления", exact: true }),
      ),
      destination = await box(
        page.getByRole("combobox", { name: "Город назначения", exact: true }),
      );
    expect(Math.abs(destination.y - origin.y)).toBeLessThanOrEqual(1);
    expect(await brokenWords(page.locator(".manual-report"))).toEqual([]);
    await capture(page, info, "manual-report-ru-narrow-two-column");
  },
);

test(
  "R2 controls keep the documented field order and tab sequence",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    const expected = [
      "manual-game",
      "field:Origin city",
      "field:Destination city",
      "field:Cargo",
      "field:Trailer type",
      "cargoMassKg",
      "actualDistanceM",
      "report-event",
      "Past events",
      "manual-comment",
      "manual-file",
      "Upload screenshot",
      "manual-target",
      "Reload telemetry targets",
      "Save draft",
      "Submit for review",
      "Back to trips",
    ];
    const order = await page
      .locator(".manual-report")
      .evaluate((root) =>
        Array.from(
          root.querySelectorAll("select, input, textarea, button, a[href], fieldset"),
          (element) =>
            element instanceof HTMLFieldSetElement
              ? `group:${element.querySelector(":scope > legend")?.textContent ?? ""}`
              : element instanceof HTMLInputElement && element.getAttribute("role") === "combobox"
                ? `field:${element.labels?.[0]?.textContent ?? ""}`
                : element.id || (element.textContent ?? "").trim(),
        ),
      );
    expect(order.filter((key) => expected.includes(key))).toEqual(expected);
    for (const [from, to] of [
      ["#cargoMassKg", "#actualDistanceM"],
      ["#actualDistanceM", "#report-event"],
      ["#manual-comment", "#manual-file"],
    ] as const) {
      await page.locator(from).focus();
      await page.keyboard.press("Tab");
      await expect(page.locator(to)).toBeFocused();
    }
    // No CSS reordering: every section follows the previous one visually.
    const tops = await page
      .locator(".manual-report-form .manual-report-section")
      .evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  },
);

test(
  "R3 the settled new report adds no live regions",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator(".manual-report [aria-live], .manual-report output")).toHaveCount(0);
    await expect(missingList(page)).toBeVisible();
  },
);

test(
  "R4 the passive requirements list follows the submission state in EN and RU",
  browserCase(["@functional", "@smoke-manual-report"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    const submit = page.getByRole("button", { name: text.en.submit, exact: true });
    await expect(missingList(page).getByRole("listitem")).toHaveText([...text.en.items]);
    await expect(submit).toBeDisabled();
    await completeForm(page);
    await expect(missingList(page)).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await page.getByLabel(text.en.mass, { exact: true }).fill("-1");
    await expect(missingList(page).getByRole("listitem")).toHaveText([text.en.mass]);
    await expect(submit).toBeDisabled();
    await catalogLanguage(page, "ru");
    await expect(missingList(page, "ru").getByRole("listitem")).toHaveText([text.ru.mass]);
    await expect(page.getByRole("button", { name: text.ru.submit, exact: true })).toBeDisabled();
    await capture(page, info, "manual-report-missing-ru");
    await page.getByLabel(text.ru.mass, { exact: true }).fill("1000");
    await expect(missingList(page, "ru")).toHaveCount(0);
    await expect(page.getByRole("button", { name: text.ru.submit, exact: true })).toBeEnabled();
  },
);

test(
  "R5 hints are accessible descriptions and Remove names its file",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    await expect(page.locator("#cargoMassKg")).toHaveAccessibleDescription(text.en.massHelp);
    await expect(page.locator("#actualDistanceM")).toHaveAccessibleDescription(
      text.en.distanceHelp,
    );
    await expect(page.locator("#report-event")).toHaveAccessibleDescription(text.en.eventHelp);
    await expect(page.locator("#manual-file")).toHaveAccessibleDescription(
      /At least one ready completion\/results screenshot is required\..*Per report: 5\./,
    );
    await completeForm(page);
    const remove = page.getByRole("button", { name: "Remove", exact: true });
    await expect(remove).toHaveCount(1);
    await expect(remove).toHaveAccessibleDescription("synthetic.png");
    await expect(page.getByText(evidenceId, { exact: true })).toBeVisible();
  },
);

test(
  "R6 controls keep pointer-appropriate target sizes",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);
    const root = page.locator(".manual-report");
    for (const control of await root
      .locator("select, input:not([type='checkbox']), textarea")
      .all()) {
      const height = (await box(control)).height;
      expect(height).toBeGreaterThanOrEqual(coarse ? 40 : 32);
    }
    for (const control of await root.locator("button, a.button").all()) {
      const height = (await box(control)).height;
      expect(height).toBeGreaterThanOrEqual(coarse ? 40 : 30);
    }
    for (const row of await root.locator(".trip-check").all())
      expect((await box(row)).height).toBeGreaterThanOrEqual(coarse ? 40 : 30);
    // Open list rows use the same pointer-appropriate target.
    await page.getByRole("combobox", { name: "Origin city", exact: true }).click();
    const options = page
      .getByRole("listbox", { name: "Origin city", exact: true })
      .getByRole("option");
    await expect(options.last()).toBeVisible();
    for (const option of await options.all())
      expect((await box(option)).height).toBeGreaterThanOrEqual(coarse ? 40 : 30);
  },
);

test(
  "R7 forbidden and invalid draft ids keep the page frame",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.route("**/api/v1/me", (route) => {
      const self = accountFixture("en");
      self.data.capabilities = self.data.capabilities.filter((c) => c !== "trips.submit_own");
      return route.fulfill({ json: self });
    });
    await page.goto("/account/reports/new");
    await expect(
      page.getByText("Your current permissions do not allow this action.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New report");
    await expect(page.getByRole("form")).toHaveCount(0);
    await capture(page, info, "manual-report-forbidden");
    await page.unroute("**/api/v1/me");
    await page.goto("/account/reports/drafts/not-a-draft-id");
    await expect(
      page.getByText("This record is unavailable or inaccessible.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New report");
  },
);

for (const status of [404, 503] as const)
  test(
    `R7 draft read ${status} offers Refresh and recovers`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      await mockTrips(page);
      const draft = example("getMyManualDraft:success").data;
      draft.id = id;
      draft.submittedReportId = null;
      let failing = true,
        reads = 0;
      await page.route(`**/api/v1/me/manual-drafts/${id}`, (route) => {
        reads++;
        return failing
          ? route.fulfill({ status, json: { error: { code: "PRIVATE_SENTINEL" } } })
          : route.fulfill({ json: envelope(draft), headers: { ETag: '"v1"' } });
      });
      await page.goto(`/account/reports/drafts/${id}`);
      await catalogLanguage(page);
      await expect(page.getByRole("alert")).toContainText(
        status === 404 ? "unavailable or inaccessible" : "service is unavailable",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("New report");
      await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
      await capture(page, info, `manual-report-draft-${status}`);
      const before = reads;
      failing = false;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect.poll(() => reads).toBeGreaterThan(before);
      await expect(page.getByRole("form", { name: "Manual report", exact: true })).toBeVisible();
    },
  );

test(
  "R7 a list read failure offers Refresh; a game with no rows shows a note",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    let failing = true,
      reads = 0;
    await page.route(
      (url) => /^\/api\/v1\/catalogs\/cities$/.test(url.pathname),
      (route) => {
        reads++;
        return failing
          ? route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } })
          : route.fallback();
      },
    );
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    const origin = page.getByRole("combobox", { name: "Origin city", exact: true }),
      field = page.locator(".manual-catalog-field").filter({ has: origin }),
      listbox = page.getByRole("listbox", { name: "Origin city", exact: true });
    // No list read happens until the field is opened.
    expect(reads).toBe(0);
    await origin.click();
    await expect(field.getByRole("alert")).toContainText("could not be read");
    await capture(page, info, "manual-report-catalog-error");
    await expect(listbox.getByRole("option", { name: "Refresh", exact: true })).toBeVisible();
    const before = reads;
    failing = false;
    await listbox.getByRole("option", { name: "Refresh", exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(field.getByRole("alert")).toHaveCount(0);
    await expect(listbox.getByRole("option", { name: /^Fictional city/ })).toBeVisible();
    await page.route("**/api/v1/catalogs/cities?*", (route) =>
      route.fulfill({ json: envelope({ items: [], nextCursor: null, total: 0 }) }),
    );
    await origin.press("Escape");
    await page.locator("#manual-game").selectOption("ats");
    await origin.click();
    await expect(
      field.getByRole("paragraph").filter({ hasText: "No rows match these filters." }),
    ).toBeVisible();
    await expect(field.getByRole("alert")).toHaveCount(0);
    await expect(listbox.getByRole("option", { name: /^Not listed/ })).toBeVisible();
    await capture(page, info, "manual-report-catalog-empty");
  },
);

test(
  "R7 choosing Not listed reveals prefilled fields and a catalog row or clear removes them",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    const cargo = page.getByRole("combobox", { name: "Cargo", exact: true }),
      listbox = page.getByRole("listbox", { name: "Cargo", exact: true }),
      group = page.getByRole("group", { name: "Cargo", exact: true }),
      label = group.getByLabel("Diagnostic label", { exact: true }),
      notListed = listbox.getByRole("option", { name: /^Not listed/ });
    await expect(group).toHaveCount(0);

    await cargo.fill("Fictional unknown cargo");
    await notListed.click();
    await expect(cargo).toHaveValue("Not listed / unresolved");
    await expect(cargo).toHaveAttribute("aria-expanded", "false");
    await expect(label).toHaveValue("Fictional unknown cargo");
    await expect(group.getByLabel("Mapping reason", { exact: true })).toHaveValue("not_listed");
    await expect(group.getByLabel("Context (optional)", { exact: true })).toHaveValue("");
    await capture(page, info, "manual-report-not-listed");

    // Re-choosing the row without new text keeps the entered label.
    await label.fill("Fictional corrected label");
    await cargo.click();
    await notListed.click();
    await expect(label).toHaveValue("Fictional corrected label");

    // Opening selects the displayed text, so the next keystroke replaces it.
    await cargo.click();
    await expect
      .poll(() =>
        cargo.evaluate((element) => {
          const input = element as HTMLInputElement;
          return [input.selectionStart, input.selectionEnd];
        }),
      )
      .toEqual([0, "Not listed / unresolved".length]);
    await cargo.press("Escape");

    // Text appended to the displayed row label is not typed text and never reaches the label.
    await page.route(
      (url) =>
        url.pathname === "/api/v1/catalogs/cargoes" &&
        !!url.searchParams.get("search")?.startsWith("Not listed"),
      (route) => route.fulfill({ json: envelope({ items: [], nextCursor: null, total: 0 }) }),
    );
    await cargo.press("End");
    await page.keyboard.type("x");
    await expect(listbox.locator('[role="option"][aria-selected="true"]')).toHaveAccessibleName(
      /^Not listed/,
    );
    await page.keyboard.press("Enter");
    await expect(cargo).toHaveValue("Not listed / unresolved");
    await expect(label).toHaveValue("Fictional corrected label");

    // Backspace leaves a prefix of the row label, which is not typed text either.
    await cargo.press("End");
    await page.keyboard.press("Backspace");
    await expect(cargo).toHaveValue("Not listed / unresolve");
    await expect(listbox.locator('[role="option"][aria-selected="true"]')).toHaveAccessibleName(
      /^Not listed/,
    );
    await page.keyboard.press("Enter");
    await expect(cargo).toHaveValue("Not listed / unresolved");
    await expect(label).toHaveValue("Fictional corrected label");

    await chooseCatalogRow(page, "Cargo", "Fictional cargo");
    await expect(group).toHaveCount(0);

    await cargo.fill("Another unknown cargo");
    await notListed.click();
    await expect(label).toHaveValue("Another unknown cargo");
    await page.getByRole("button", { name: "Clear selection: Cargo", exact: true }).click();
    await expect(group).toHaveCount(0);
    await expect(cargo).toHaveValue("");
  },
);

test(
  "R7 a hidden saved selection stays visible with its mark and note",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockTrips(page);
    const draft = example("getMyManualDraft:success").data;
    draft.id = id;
    draft.submittedReportId = null;
    draft.fields.origin = { status: "resolved", entityId };
    await page.route(`**/api/v1/me/manual-drafts/${id}`, (route) =>
      route.fulfill({ json: envelope(draft), headers: { ETag: '"v1"' } }),
    );
    const base = catalogItem(entityId, "Fictional hidden city");
    await page.route(
      (url) => url.pathname === `/api/v1/catalogs/cities/${entityId}`,
      (route) =>
        route.fulfill({
          json: envelope({ ...base, hidden: true, display: { ...base.display, hidden: true } }),
        }),
    );
    await page.goto(`/account/reports/drafts/${id}`);
    await catalogLanguage(page);
    const origin = page.getByRole("combobox", { name: "Origin city", exact: true }),
      field = page.locator(".manual-catalog-field").filter({ has: origin });
    await expect(origin).toHaveValue("Fictional hidden city");
    await expect(field.getByText("hidden", { exact: true })).toBeVisible();
    await expect(field.getByText(/Kept for reading/)).toBeVisible();
    await expect(origin).toHaveAttribute("data-historical", "true");
    await expect(origin).toHaveAccessibleDescription(/hidden.*Kept for reading/);
    await capture(page, info, "manual-report-hidden-selection");
  },
);

test(
  "R7 the last catalog list opens clear of the phone bar",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    const trailer = page.getByRole("combobox", { name: "Trailer type", exact: true }),
      listbox = page.getByRole("listbox", { name: "Trailer type", exact: true });
    // Park the field just above the phone bar so the opened list would otherwise run under it.
    await trailer.evaluate((element) =>
      window.scrollTo(0, element.getBoundingClientRect().top + scrollY - innerHeight + 130),
    );
    await trailer.click();
    await expect(listbox.getByRole("option").last()).toBeVisible();
    await expect
      .poll(async () => {
        const bar = await box(page.locator(".bottom-nav")),
          list = await box(listbox);
        return list.y + list.height <= bar.y + 1;
      })
      .toBe(true);
    await capture(page, info, "manual-report-list-above-phone-bar");
  },
);

test(
  "R7 uploaded evidence moves from Processing to Ready",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    let processing = true;
    const evidence = () =>
      envelope({
        id: evidenceId,
        state: processing ? "processing" : "ready",
        contentType: "image/png",
        byteLength: pngBytes().length,
        originalName: "synthetic.png",
      });
    await page.route("**/api/v1/evidence", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 202, json: evidence() })
        : route.fallback(),
    );
    await page.route(`**/api/v1/evidence/${evidenceId}`, (route) =>
      route.fulfill({ json: evidence() }),
    );
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await settled(page);
    await page
      .getByLabel("Choose completion screenshot", { exact: true })
      .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
    await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
    const item = page.locator(".manual-evidence-list .trip-evidence");
    await expect(item).toContainText("Processing · image/png");
    await expect(missingList(page).getByRole("listitem")).toContainText([
      "A ready completion screenshot",
    ]);
    processing = false;
    await expect(item).toContainText("Ready · image/png", { timeout: 5000 });
    await expect(missingList(page).getByRole("listitem")).not.toContainText([
      "A ready completion screenshot",
    ]);
  },
);

test(
  "R8 the portaled confirmation fits a phone and shows the exact target",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    await mockTrips(page);
    await page.goto("/account/reports/new");
    await catalogLanguage(page);
    await completeForm(page);
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await page.getByRole("button", { name: text[locale].submit, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(text[locale].noTarget);
      const rect = await box(dialog),
        viewport = page.viewportSize();
      if (!viewport) throw new Error("VIEWPORT_MISSING");
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
      const overflow = await dialog.evaluate((element) => ({
        y: getComputedStyle(element).overflowY,
        fits: element.scrollWidth <= element.clientWidth,
      }));
      expect(overflow).toEqual({ y: "auto", fits: true });
      await noOverflow(page);
      await dialog.screenshot({ path: info.outputPath(`manual-report-confirm-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  },
);
