import { catalogId, catalogLanguage, envelope, list, revision } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { levels, mockQualifications, ruleId } from "./support/qualifications.ts";

const trailerId = (i: number) => `63100000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
const adrId = "63200000-0000-4000-8000-000000000001",
  otherRevision = "61000000-0000-4000-8000-000000000021";
for (const locale of ["en", "ru"] as const) {
  test(`controlled qualification ${locale} retained draft catalog labels are bounded named and revision safe`, async ({
    page,
  }, info) => {
    const state = await mockQualifications(page, locale),
      requests: string[] = [];
    await page.route("**/api/v1/catalogs/**", async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname,
        rev = url.searchParams.get("revisionId") ?? catalogId,
        lang = url.searchParams.get("locale") === "ru" ? "ru" : "en";
      if (path.endsWith("/revisions"))
        return route.fulfill({ json: list([revision(), revision(otherRevision)]) });
      const id = path.split("/").at(-1) ?? "",
        kind = url.searchParams.get("kind") ?? (id === adrId ? "adr_category" : "trailer_type");
      const entity = (entityId: string) => ({
        id: entityId,
        revisionId: catalogId,
        game: "ets2",
        kind,
        mapNamespace: "base",
        display: {
          entityId,
          label:
            kind === "adr_category"
              ? "Fictional ADR"
              : `Fictional trailer ${Number(entityId.slice(-12))}`,
          requestedLocale: lang,
          renderedLocale: "en",
          englishFallback: lang === "ru",
          retired: entityId === trailerId(1),
        },
        relatedEntityIds: [],
      });
      if (path.endsWith("/entities"))
        return route.fulfill({
          json: list((kind === "adr_category" ? [adrId] : [trailerId(27)]).map(entity)),
        });
      requests.push(`${id}:${rev}:${lang}`);
      if (id === trailerId(2)) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: envelope(entity(id)) });
    });
    await page.route("**/api/v1/qualification-levels/*/rule-versions/*", (route) =>
      route.fulfill({
        json: envelope({
          id: ruleId,
          levelId: route.request().url().split("/")[6],
          game: "ets2",
          publishedAt: "2026-10-20T12:00:00.000Z",
          effectiveAt: "2026-10-20T12:00:00.000Z",
          rules: [
            {
              type: "allowed_trailer_types",
              entityIds: Array.from({ length: 26 }, (_, i) => trailerId(i + 1)),
            },
            { type: "allowed_adr_categories", entityIds: [adrId] },
          ],
          requiredTrips: 2,
          requiredDistanceM: "100",
        }),
      }),
    );
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card
      .getByRole("button", {
        name: locale === "en" ? "Edit rules" : "Редактировать правила",
        exact: true,
      })
      .click();
    const editor = card.locator("section").last(),
      trailerLabel = locale === "en" ? "Allowed trailer types" : "Разрешённые типы прицепов",
      adrLabel = locale === "en" ? "Allowed ADR categories" : "Разрешённые категории ADR";
    const trailer = editor
        .locator("fieldset")
        .filter({ has: page.locator("legend", { hasText: trailerLabel }) })
        .last(),
      adr = editor
        .locator("fieldset")
        .filter({ has: page.locator("legend", { hasText: adrLabel }) })
        .last(),
      add = locale === "en" ? "Add selected value" : "Добавить выбранное значение";
    await expect(trailer.locator("li")).toHaveCount(25);
    await expect(trailer.locator("li").first()).toContainText("Fictional trailer 1");
    await expect(trailer.locator("li").first()).toContainText(
      locale === "en" ? "Retired" : "Архивное",
    );
    await expect(trailer.locator("li").nth(1)).toContainText(
      locale === "en" ? "Catalog label unavailable" : "Название из каталога недоступно",
    );
    if (locale === "ru")
      await expect(trailer.locator("li").first()).toContainText("Показано на английском");
    expect(requests.some((value) => value.startsWith(`${trailerId(26)}:`))).toBe(false);
    expect(
      new Set(requests.filter((value) => value.startsWith("63100000")).map((v) => v.split(":")[0]))
        .size,
    ).toBeLessThanOrEqual(25);
    await trailer
      .getByRole("button", {
        name: locale === "en" ? "Next page" : "Следующая страница",
        exact: true,
      })
      .click();
    await expect(trailer.locator("li")).toHaveCount(1);
    await expect(trailer.locator("li")).toContainText("Fictional trailer 26");
    await trailer
      .getByRole("button", {
        name: locale === "en" ? "Previous page" : "Предыдущая страница",
        exact: true,
      })
      .click();
    await expect(adr.locator("li")).toContainText("Fictional ADR");
    await adr.getByRole("button", { name: /Fictional ADR/ }).click();
    await expect(adr.locator("li")).toHaveCount(0);
    await adr.getByRole("combobox", { name: adrLabel, exact: true }).selectOption(adrId);
    await adr.getByRole("button", { name: add, exact: true }).click();
    await expect(adr.locator("li")).toContainText("Fictional ADR");
    await trailer
      .getByRole("combobox", { name: trailerLabel, exact: true })
      .selectOption(trailerId(27));
    await trailer.getByRole("button", { name: add, exact: true }).click();
    await expect(trailer.locator("li").filter({ hasText: "Fictional trailer 27" })).toBeVisible();
    await expect(trailer.locator("li")).toHaveCount(2);
    const sample = editor
      .locator("fieldset")
      .filter({
        has: page.locator("legend", {
          hasText: locale === "en" ? "Hypothetical sample" : "Условный пример",
        }),
      })
      .last();
    const sampleLabel = locale === "en" ? "Sample trailer type" : "Тип прицепа в примере";
    for (let i = 0; i < 2; i++) {
      await sample
        .getByRole("combobox", { name: sampleLabel, exact: true })
        .selectOption(trailerId(27));
      await sample.getByRole("button", { name: add, exact: true }).click();
    }
    await expect(sample.locator("li")).toHaveCount(2);
    await expect(sample.getByRole("button", { name: /1\. Fictional trailer 27/ })).toBeVisible();
    await sample.getByRole("button", { name: /1\. Fictional trailer 27/ }).click();
    await expect(sample.locator("li")).toHaveCount(1);
    await editor.locator('[id^="reason-"]').fill("Fictional labelled draft");
    const firstPreview = page.waitForResponse(
      (response) =>
        response.url().endsWith("/admin/qualification-rule-previews") &&
        response.request().method() === "POST",
    );
    await editor
      .getByRole("button", {
        name: locale === "en" ? "Evaluate sample" : "Проверить пример",
        exact: true,
      })
      .click();
    await firstPreview;
    expect(state.previewInputs.at(-1)?.rules).toEqual([
      {
        type: "allowed_trailer_types",
        entityIds: Array.from({ length: 27 }, (_, i) => trailerId(i + 1)),
      },
      { type: "allowed_adr_categories", entityIds: [adrId] },
    ]);
    expect(state.previewInputs.at(-1)?.sample.trailerTypeIds).toEqual([trailerId(27)]);
    const unchangedWireInput = JSON.stringify(state.previewInputs.at(-1));
    await catalogLanguage(page, locale === "en" ? "ru" : "en");
    await expect(editor.getByText(adrId, { exact: true })).toBeVisible();
    await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional labelled draft");
    const localePreview = page.waitForResponse(
      (response) =>
        response.url().endsWith("/admin/qualification-rule-previews") &&
        response.request().method() === "POST",
    );
    await editor
      .getByRole("button", {
        name: locale === "en" ? "Проверить пример" : "Evaluate sample",
        exact: true,
      })
      .click();
    await localePreview;
    expect(JSON.stringify(state.previewInputs.at(-1))).toBe(unchangedWireInput);
    await catalogLanguage(page, locale);
    await expect(trailer.locator("li").filter({ hasText: "Fictional trailer 27" })).toBeVisible();
    await expect(adr.locator("li")).toContainText("Fictional ADR");
    await expect(sample.locator("li")).toContainText("Fictional trailer 27");
    await editor.screenshot({
      path: info.outputPath(`qualification-labelled-draft-${locale}.png`),
    });
    await trailer.getByRole("button", { name: /Fictional trailer 27/ }).click();
    await expect(trailer.locator("li").filter({ hasText: "Fictional trailer 27" })).toHaveCount(0);
    await expect(
      editor.getByRole("button", {
        name: locale === "en" ? "Publish rule version" : "Опубликовать версию правил",
        exact: true,
      }),
    ).toBeDisabled();
    await trailer
      .getByRole("combobox", { name: trailerLabel, exact: true })
      .selectOption(trailerId(27));
    await editor.locator('[id^="catalog-"]').selectOption(otherRevision);
    await expect(trailer.getByRole("button", { name: add, exact: true })).toBeDisabled();
    await expect(adr.locator("li")).toContainText(
      locale === "en" ? "Catalog label unavailable" : "Название из каталога недоступно",
    );
    await expect(sample.locator("li")).toContainText(
      locale === "en" ? "Catalog label unavailable" : "Название из каталога недоступно",
    );
    expect(state.previewInputs.at(-1)?.sample.trailerTypeIds).toEqual([trailerId(27)]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`controlled qualification ${locale} staff action and publisher context preserve recorded and effective distinctions`, async ({
    page,
  }, info) => {
    await mockQualifications(page, locale);
    await page.route("**/api/v1/admin/members/*/qualification-action-history?*", (route) =>
      route.fulfill({
        json: list([
          {
            id: trailerId(90),
            periodId: trailerId(90),
            game: "ets2",
            levelId: levels("ets2")[1]?.id,
            assignedAt: "2026-10-20T12:00:00.000Z",
            endedAt: null,
            purpose: "promotion",
            actor: { id: trailerId(91), nickname: "Fictional reviewed operator" },
            promotion: { id: trailerId(92), confirmedAt: "2026-10-20T12:00:01.000Z" },
          },
          {
            id: trailerId(93),
            periodId: trailerId(93),
            game: "ets2",
            levelId: levels("ets2")[0]?.id,
            assignedAt: "2020-01-01T00:00:00.000Z",
            endedAt: "2020-01-02T00:00:00.000Z",
            purpose: "historical_resolution",
            actor: null,
            promotion: null,
          },
        ]),
      }),
    );
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    const history = page
      .getByRole("heading", {
        name: locale === "en" ? "Assignment history" : "История назначений",
        exact: true,
      })
      .locator("..");
    await expect(history).toContainText("Fictional reviewed operator");
    await expect(history).toContainText(trailerId(92));
    await expect(history).toContainText(
      locale === "en" ? "Promotion confirmed" : "Повышение подтверждено",
    );
    await expect(history).toContainText(
      locale === "en" ? "Actor not recorded" : "Автор не записан",
    );
    await expect(history).toContainText(
      locale === "en" ? "Effective interval" : "Интервал действия",
    );
    const current = history.locator("article").filter({ hasText: trailerId(90) }),
      closed = history.locator("article").filter({ hasText: trailerId(93) });
    for (const row of [current, closed])
      await expect(row.locator("small")).toContainText(
        locale === "en" ? "Assignment ID" : "Идентификатор назначения",
      );
    await expect(current.locator("small")).toContainText(trailerId(90));
    await expect(current).not.toContainText(
      locale === "en" ? "Exclusive end" : "Конец не включается",
    );
    await expect(closed.locator("p").last()).toContainText(
      locale === "en" ? "Exclusive end" : "Конец не включается",
    );
    await expect(closed.locator("small")).not.toContainText(
      locale === "en" ? "Exclusive end" : "Конец не включается",
    );
    await history.screenshot({
      path: info.outputPath(`qualification-action-history-${locale}.png`),
    });
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card
      .getByText(locale === "en" ? "Rule version history" : "История версий правил", {
        exact: true,
      })
      .click();
    await expect(
      card.getByText("Fictional current publisher", { exact: false }).first(),
    ).toBeVisible();
    await expect(card).toContainText(
      locale === "en" ? "Recorded publisher" : "Записанный издатель",
    );
    await card.screenshot({
      path: info.outputPath(`qualification-publisher-history-${locale}.png`),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
