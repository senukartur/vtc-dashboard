import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

for (const route of ["/foundation", "/foundation/member"]) {
  for (const locale of ["ru", "en"]) {
    test(`synthetic rendered ${route} ${locale}: layouts, long labels and complete states`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", () => errors.push("page error"));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route);
      await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption(locale);
      const ru = locale === "ru";
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("columnheader", {
          name: ru ? "Фактический пробег (км)" : "Actual distance (km)",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(
        page.getByText(ru ? "Синтетический пример" : "Synthetic preview", { exact: true }),
      ).toBeVisible();
      const city = page.getByRole("combobox", {
        name: ru ? "Выбор из каталога" : "Catalog selection",
        exact: true,
      });
      const selected = await city.inputValue();
      expect(selected).toBe("41000000-0000-4000-8000-000000000001");
      await expect(page.getByText("Fixture Driver", { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole("region", {
            name: ru ? "Принятый пробег по отчётным дням" : "Accepted distance by reporting day",
            exact: true,
          })
          .getByRole("table"),
      ).toBeVisible();
      await noOverflow(page);
      await capture(page, info, `${locale}-available`);
      const state = page.getByRole("combobox", {
        name: ru ? "Состояние примера" : "Example state",
        exact: true,
      });
      for (const item of ["loading", "empty", "error", "partial", "forbidden"]) {
        await state.selectOption(item);
        if (item === "loading")
          await expect(
            page.getByText(ru ? "Загружаем синтетические рейсы…" : "Loading synthetic trips…", {
              exact: true,
            }),
          ).toBeVisible();
        if (item === "empty")
          await expect(
            page.getByRole("heading", {
              name: ru ? "В этом примере нет рейсов" : "No trips in this example",
            }),
          ).toBeVisible();
        if (item === "error")
          await expect(page.getByRole("alert")).toContainText(
            ru ? "Не удалось загрузить пример" : "Could not load this example",
          );
        if (item === "partial") {
          await expect(
            page.getByRole("cell", { name: ru ? /Недоступно$/ : /Unavailable$/ }),
          ).toBeVisible();
          await expect(page.getByRole("cell", { name: "0 km", exact: true })).toHaveCount(0);
        }
        if (item === "forbidden") {
          await expect(page.getByText("Fixture Driver", { exact: true })).toHaveCount(0);
          await expect(city).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              name: ru ? "Принятый пробег по отчётным дням" : "Accepted distance by reporting day",
            }),
          ).toHaveCount(0);
        }
        await noOverflow(page);
        await capture(page, info, `${locale}-${item}`);
      }
      await state.selectOption("success");
      await expect(city).toHaveValue(selected);
      await page
        .getByRole("button", { name: ru ? "Об этом примере" : "About this preview", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, info, `${locale}-dialog`);
      await page.keyboard.press("Escape");
      const menu = page.getByRole("button", {
        name: ru ? "Открыть навигацию" : "Open navigation",
        exact: true,
      });
      if (await menu.isVisible()) {
        await menu.click();
        await capture(page, info, `${locale}-mobile-navigation`);
        await page.keyboard.press("Escape");
      }
      expect(errors).toEqual([]);
    });
  }
}

test("synthetic local form preserves input, prevents duplicate pending submissions and confirms locally", async ({
  page,
}) => {
  await page.goto("/foundation");
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  const submit = page.getByRole("button", { name: "Preview confirmation", exact: true });
  const note = page.getByRole("textbox", { name: "Example note", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Enter a note");
  await expect(note).toBeFocused();
  await note.fill("Synthetic route inspection");
  await page.getByRole("checkbox", { name: "Simulate a recoverable failure" }).check();
  await submit.click();
  const pending = page.getByRole("button", { name: "Preparing preview…", exact: true });
  await expect(pending).toBeDisabled();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText(
    "The synthetic attempt failed. Your note is preserved; try again.",
  );
  await expect(note).toHaveValue("Synthetic route inspection");
  await page.getByRole("checkbox").uncheck();
  await submit.click();
  await expect(page.getByRole("status")).toHaveText(
    "Preview confirmed locally. No company action was submitted.",
  );
  await expect(note).toHaveValue("Synthetic route inspection");
});

test("synthetic keyboard dialogs, skip link, navigation and locale preserve canonical selection", async ({
  page,
}) => {
  await page.goto("/foundation");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const city = page.getByRole("combobox", { name: "Выбор из каталога", exact: true });
  const id = await city.inputValue();
  await expect(page.getByText("Название на английском", { exact: true })).toHaveCount(2);
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  await expect(page.getByRole("combobox", { name: "Catalog selection", exact: true })).toHaveValue(
    id,
  );
  await expect(page.getByText("English name fallback", { exact: true })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "About this preview", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "About this preview", exact: true });
  await expect(dialog).toContainText("English namespace fallback is available.");
  const connection = dialog.getByRole("link", { name: "Connection", exact: true });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(connection).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
    await navigation.getByRole("link", { name: "Member preview", exact: true }).click();
    await expect(navigation).toHaveCount(0);
    await expect(menu).toBeFocused();
  } else {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Member preview", exact: true })
      .click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Member workspace composition");
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("link", { name: "Member preview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  if (await menu.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  }
});

test("synthetic chart keeps exact values and company reporting days when display timezone changes", async ({
  page,
}) => {
  await page.goto("/foundation");
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  const chart = page.getByRole("region", {
    name: "Accepted distance by reporting day",
    exact: true,
  });
  await expect(chart.getByRole("cell", { name: "12.5005 km", exact: true })).toBeVisible();
  await expect(chart.getByRole("rowheader", { name: "2026-10-17", exact: true })).toBeVisible();
  await expect(chart).toContainText("Example reporting timezone: UTC");
  await expect(chart).toContainText("17 Oct 2026, 12:00 (UTC)");
  await page
    .getByRole("combobox", { name: "Your display timezone", exact: true })
    .selectOption("America/Los_Angeles");
  await expect(chart).toContainText("17 Oct 2026, 05:00 (America/Los_Angeles)");
  await expect(chart.getByRole("rowheader", { name: "2026-10-17", exact: true })).toBeVisible();
  await expect(chart.getByRole("cell", { name: "12.5005 km", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Example state", exact: true }).selectOption("error");
  await page.getByRole("button", { name: "Retry example", exact: true }).click();
  await expect(page.getByText("Fixture Driver", { exact: true })).toBeVisible();
});

test("controlled lazy route loading keeps the shell useful and failed route recovers safely", async ({
  page,
}) => {
  let release = () => {};
  let failed = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/FoundationPage-[^/]+\.js$/, async (route) => {
    await gate;
    if (failed) await route.abort("failed");
    else await route.continue();
  });
  try {
    await page.goto("/foundation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status")).toHaveText("Загружаем страницу…");
    await expect(page.getByRole("combobox", { name: "Язык", exact: true })).toBeVisible();
    release();
    await expect(
      page.getByRole("heading", { name: "Не удалось отобразить страницу", exact: true }),
    ).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Перезагрузить страницу", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Общий язык в пути", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
