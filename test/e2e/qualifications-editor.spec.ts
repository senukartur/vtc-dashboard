import {
  catalogItem,
  catalogLanguage,
  catalogList,
  chooseCatalogRow,
  envelope,
  list,
} from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { levels, mockQualifications, ruleId } from "./support/qualifications.ts";

const trailerId = (i: number) => `63100000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
for (const locale of ["en", "ru"] as const) {
  test(
    `controlled qualification ${locale} publishes an exact 20 km minimum without a reason or sample`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await mockQualifications(page, locale);
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
        publish = editor.getByRole("button", {
          name: locale === "en" ? "Publish rule version" : "Опубликовать версию правил",
          exact: true,
        }),
        preview = editor.getByRole("button", {
          name: locale === "en" ? "Evaluate sample" : "Проверить пример",
          exact: true,
        }),
        confirm = page.getByRole("dialog").getByRole("button", {
          name: locale === "en" ? "Confirm" : "Подтвердить",
          exact: true,
        }),
        field = (name: string) => editor.locator(`:is(input, select)[id^="${name}-"]`),
        required = locale === "en" ? "(required)" : "(обязательно)";
      for (const [fieldName, label] of [
        ["level-name", locale === "en" ? "Level name" : "Название уровня"],
        ["mass", locale === "en" ? "Maximum cargo mass (kg)" : "Максимальная масса груза (кг)"],
      ] as const) {
        await expect(field(fieldName)).toHaveJSProperty("required", true);
        await expect(editor.getByText(`${label} ${required}`, { exact: true })).toBeVisible();
      }
      for (const optional of ["count", "distance", "reason", "sample-mass"])
        await expect(field(optional)).toHaveJSProperty("required", false);
      await expect(field("distance")).toHaveValue(locale === "en" ? "0.1" : "0,1");
      await field("count").fill("");
      await field("distance").fill("100000000000000000");
      await expect(field("distance")).toHaveAttribute("aria-invalid", "true");
      await expect(field("distance")).toHaveAccessibleDescription(
        locale === "en"
          ? "Enter a non-negative distance in km with up to 17 integer and 21 fractional digits."
          : "Введите неотрицательное расстояние в км: до 17 цифр в целой части и до 21 в дробной.",
      );
      await expect(publish).toBeDisabled();
      await field("distance").fill("20");
      await field("mode").selectOption("schedule");
      await expect(field("effective")).toHaveJSProperty("required", true);
      await expect(
        editor.getByText(
          `${locale === "en" ? "Effective time (UTC)" : "Начало действия (UTC)"} ${required}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(field("effective")).toHaveAttribute("aria-invalid", "true");
      await expect(publish).toBeDisabled();
      await field("mode").selectOption("immediate");
      await expect(field("effective")).toHaveCount(0);
      await expect(field("reason")).toHaveValue("");
      await expect(field("sample-mass")).toHaveValue("");
      await publish.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(
        locale === "en" ? "Trips: No minimum · 20 km" : "Рейсы: Без минимума · 20 км",
      );
      expect(state.publications).toEqual([]);
      await dialog.screenshot({
        path: info.outputPath(`qualification-distance-confirm-${locale}.png`),
      });
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(state.publications).toEqual([
        {
          rules: [{ type: "max_mass", maxKg: "10" }],
          requiredTrips: null,
          requiredDistanceM: "20000",
        },
      ]);
      expect(state.previewInputs).toEqual([]);

      // Optional evaluation is available, but a stale or incomplete sample leaves publication usable.
      await field("sample-mass").fill("10");
      await preview.click();
      await expect(
        editor.getByRole("heading", {
          name: locale === "en" ? "Sample outcome: Pass" : "Результат примера: Соответствует",
        }),
      ).toBeVisible();
      await field("adr-status").selectOption("known");
      await expect(field("adr-class")).toHaveJSProperty("required", true);
      await expect(
        editor.getByText(
          `${locale === "en" ? "Sample ADR category" : "Категория ADR в примере"} ${required}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(field("adr-class")).toHaveAttribute("aria-invalid", "true");
      await expect(preview).toBeDisabled();
      await expect(
        editor.getByRole("heading", { name: /Sample outcome|Результат примера/ }),
      ).toHaveCount(0);
      await field("distance").fill(locale === "en" ? "20.125" : "20,125");
      await publish.click();
      await expect(dialog).toContainText(locale === "en" ? "20.125 km" : "20,125 км");
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(state.publications.at(-1)?.requiredDistanceM).toBe("20125");
      expect(state.previewInputs).toHaveLength(1);
    },
  );

  test(
    `controlled qualification ${locale} retained draft trailer labels are bounded, named and keep the sample to one trailer`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await mockQualifications(page, locale),
        requests: string[] = [];
      await page.route("**/api/v1/catalogs/trailers**", async (route) => {
        const url = new URL(route.request().url()),
          path = url.pathname,
          lang = url.searchParams.get("locale") === "ru" ? "ru" : "en";
        const row = (entityId: string) => {
          const hidden = entityId === trailerId(1);
          return catalogItem(entityId, `Fictional trailer ${Number(entityId.slice(-12))}`, lang, {
            hidden,
            display: {
              entityId,
              label: `Fictional trailer ${Number(entityId.slice(-12))}`,
              requestedLocale: lang,
              renderedLocale: "en",
              englishFallback: lang === "ru",
              hidden,
            },
          });
        };
        if (path.endsWith("/trailers"))
          return route.fulfill({ json: catalogList([row(trailerId(27))]) });
        const id = path.split("/").at(-1) ?? "";
        requests.push(`${id}:${lang}`);
        if (id === trailerId(2)) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: envelope(row(id)) });
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
              { type: "allowed_adr_categories", classes: ["2"] },
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
        locale === "en" ? "hidden" : "скрыт",
      );
      await expect(trailer.locator("li").nth(1)).toContainText(
        locale === "en" ? "Catalog label unavailable" : "Название из каталога недоступно",
      );
      if (locale === "ru")
        await expect(trailer.locator("li").first()).toContainText("Показано на английском");
      expect(requests.some((value) => value.startsWith(`${trailerId(26)}:`))).toBe(false);
      expect(
        new Set(
          requests.filter((value) => value.startsWith("63100000")).map((v) => v.split(":")[0]),
        ).size,
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
      const adrTwo = adr.getByRole("checkbox", {
        name: locale === "en" ? "ADR class 2" : "Класс ADR 2",
        exact: true,
      });
      await expect(adrTwo).toBeChecked();
      await adrTwo.uncheck();
      await expect(adrTwo).not.toBeChecked();
      await adrTwo.check();
      const trailerField = trailer.getByRole("combobox", { name: trailerLabel, exact: true });
      await trailerField.click();
      // Only the report fields offer the not-listed row.
      await expect(
        trailer.getByRole("listbox", { name: trailerLabel, exact: true }).getByRole("option"),
      ).toHaveCount(1);
      await expect(trailer.getByRole("option", { name: /Not listed|Нет в каталоге/ })).toHaveCount(
        0,
      );
      await chooseCatalogRow(trailer, trailerLabel, "Fictional trailer 27");
      await trailer.getByRole("button", { name: add, exact: true }).click();
      await expect(trailer.locator("li").filter({ hasText: "Fictional trailer 27" })).toBeVisible();
      await expect(trailer.locator("li")).toHaveCount(2);
      await expect(trailerField).toHaveValue("");
      const sample = editor
        .locator("fieldset")
        .filter({
          has: page.locator("legend", {
            hasText: locale === "en" ? "Hypothetical sample" : "Условный пример",
          }),
        })
        .last();
      const sampleLabel = locale === "en" ? "Sample trailer type" : "Тип прицепа в примере";
      await chooseCatalogRow(sample, sampleLabel, "Fictional trailer 27");
      await sample.getByRole("button", { name: add, exact: true }).click();
      await expect(sample.locator("li")).toHaveCount(1);
      await expect(sample.getByRole("button", { name: /1\. Fictional trailer 27/ })).toBeVisible();
      await expect(sample.getByRole("combobox", { name: sampleLabel, exact: true })).toHaveValue(
        "",
      );
      await chooseCatalogRow(sample, sampleLabel, "Fictional trailer 27");
      await expect(sample.getByRole("button", { name: add, exact: true })).toBeDisabled();
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
        { type: "allowed_adr_categories", classes: ["2"] },
      ]);
      expect(state.previewInputs.at(-1)?.sample.trailerTypeIds).toEqual([trailerId(27)]);
      const unchangedWireInput = JSON.stringify(state.previewInputs.at(-1));
      await catalogLanguage(page, locale === "en" ? "ru" : "en");
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
      await expect(adrTwo).toBeChecked();
      await expect(sample.locator("li")).toContainText("Fictional trailer 27");
      await editor.screenshot({
        path: info.outputPath(`qualification-labelled-draft-${locale}.png`),
      });
      await trailer.getByRole("button", { name: /Fictional trailer 27/ }).click();
      await expect(trailer.locator("li").filter({ hasText: "Fictional trailer 27" })).toHaveCount(
        0,
      );
      await expect(
        editor.getByRole("heading", { name: /Sample outcome|Результат примера/ }),
      ).toHaveCount(0);
      await expect(
        editor.getByRole("button", {
          name: locale === "en" ? "Publish rule version" : "Опубликовать версию правил",
          exact: true,
        }),
      ).toBeEnabled();
      expect(state.previewInputs.at(-1)?.sample.trailerTypeIds).toEqual([trailerId(27)]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    },
  );

  test(
    `controlled qualification ${locale} staff action and publisher context preserve recorded and effective distinctions`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockQualifications(page, locale);
      await page.route("**/api/v1/admin/members/*/qualification-action-history?*", (route) =>
        route.fulfill({
          json: list([
            {
              id: trailerId(90),
              periodId: trailerId(90),
              game: "ets2",
              levelId: levels("ets2")[1]?.id,
              levelName: levels("ets2")[1]?.name,
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
              levelName: levels("ets2")[0]?.name,
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
    },
  );
}
