import { createHash } from "node:crypto";
import type { Locator, Page, Response, TestInfo } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

const bundledFont = /\/assets\/huninn-[^/]+\.woff2$/;
const fontStack = /^"?Huninn"?, system-ui, sans-serif$/;

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function contrast(
  locator: Locator,
  pseudo?: string,
  property: "color" | "borderTopColor" | "borderBottomColor" = "color",
  outside = false,
) {
  return locator.evaluate(
    (element, options) => {
      const rgba = (value: string) => {
        const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
      };
      const mix = (front: number[], back: number[]) =>
        [0, 1, 2].map(
          (index) =>
            (front[index] ?? 0) * (front[3] ?? 1) + (back[index] ?? 0) * (1 - (front[3] ?? 1)),
        );
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement)
        ancestors.unshift(node);
      let background = [255, 255, 255];
      for (const node of ancestors)
        if (!options.outside || node !== element)
          background = mix(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = mix(
        rgba(getComputedStyle(element, options.pseudo)[options.property]),
        background,
      );
      const luminance = (color: number[]) =>
        color
          .map((value) => value / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
      const a = luminance(foreground),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    { pseudo, property, outside },
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
      await page.evaluate(() => document.fonts.ready);
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
}, info) => {
  await page.goto("/foundation");
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  const submit = page.getByRole("button", { name: "Preview confirmation", exact: true });
  const note = page.getByRole("textbox", { name: "Example note", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Enter a note");
  await expect(note).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(note).toBeFocused();
  await capture(page, info, "keyboard-invalid-form-focus");
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

test("synthetic local form retains keyboard progress when validation timers run", async ({
  page,
}) => {
  let phase = "DISCOVERY";
  await page.clock.install({ time: new Date("2026-10-20T12:00:00Z") });
  try {
    await page.goto("/foundation");
    await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
    const submit = page.getByRole("button", { name: "Preview confirmation", exact: true });
    const note = page.getByRole("textbox", { name: "Example note", exact: true });
    const checkbox = page.getByRole("checkbox", { name: "Simulate a recoverable failure" });
    await expect(note).toBeVisible();
    await page.clock.pauseAt(new Date("2026-10-20T13:00:00Z"));
    phase = "INVALID";
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText("Enter a note");
    await expect(note).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(checkbox).toBeFocused();
    phase = "DEFERRED_FOCUS";
    // Run queued zero-delay validation work after keyboard progress, without sleeping.
    await page.clock.runFor(0);
    await expect(checkbox).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(note).toBeFocused();
    await page.clock.resume();
    phase = "RECOVERY";
    await note.fill("Synthetic route inspection");
    await checkbox.check();
    await submit.click();
    const pending = page.getByRole("button", { name: "Preparing preview…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(checkbox).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveText(
      "The synthetic attempt failed. Your note is preserved; try again.",
    );
    await expect(note).toHaveValue("Synthetic route inspection");
    await checkbox.uncheck();
    await submit.click();
    await expect(page.getByRole("status")).toHaveText(
      "Preview confirmed locally. No company action was submitted.",
    );
    await expect(note).toHaveValue("Synthetic route inspection");
  } catch {
    throw new Error(`LOCAL_FORM_CLOCK_${phase}_FAILED`);
  } finally {
    await page.clock.resume();
  }
});

test("synthetic keyboard dialogs, skip link, navigation and locale preserve canonical selection", async ({
  page,
}, info) => {
  await page.goto("/foundation");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
  await capture(page, info, "keyboard-skip-focus");
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
  await capture(page, info, "keyboard-dialog-focus");
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  const mobileNavigation = await menu.isVisible();
  if (mobileNavigation) {
    await menu.focus();
    await page.keyboard.press("Enter");
    const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
    await page.keyboard.press("Tab");
    await capture(page, info, "keyboard-public-menu-focus");
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
  const memberMobileNavigation = await menu.isVisible();
  if (memberMobileNavigation) {
    await menu.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await capture(page, info, "keyboard-member-menu-focus");
  }
  await expect(page.getByRole("link", { name: "Member preview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  if (memberMobileNavigation) {
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  }
});

test("VTC019 ordering regression: mobile route closure has one focus owner and ordinary navigation still focuses main", async ({
  page,
}) => {
  let phase = "DISCOVERY";
  try {
    await page.goto("/foundation");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
    const menu = page.getByRole("button", { name: /^(Open navigation|Открыть навигацию)$/ });
    const mobileNavigation = await menu.isVisible();
    const main = page.getByRole("main");
    await main.evaluate((element) => {
      element.dataset.orderingFocusCount = "0";
      element.addEventListener("focus", () => {
        element.dataset.orderingFocusCount = String(Number(element.dataset.orderingFocusCount) + 1);
      });
    });
    if (mobileNavigation) {
      phase = "MOBILE_ROUTE";
      await menu.click();
      const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
      await navigation.getByRole("link", { name: "Member preview", exact: true }).click();
      await expect(navigation).toHaveCount(0);
      await expect(menu).toBeFocused();
    } else {
      phase = "DESKTOP_ROUTE";
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "Member preview", exact: true })
        .click();
      await expect(main).toBeFocused();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Member workspace composition",
    );
    phase = "ROUTE_FOCUS";
    await expect(main).toHaveAttribute("data-ordering-focus-count", mobileNavigation ? "0" : "1");
    const memberMobileNavigation = await menu.isVisible();
    if (memberMobileNavigation) {
      phase = "SAME_PATH";
      await main.evaluate((element) => {
        element.dataset.orderingFocusCount = "0";
      });
      await menu.click();
      const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
      await navigation.getByRole("link", { name: "Member preview", exact: true }).click();
      await expect(navigation).toHaveCount(0);
      await expect(menu).toBeFocused();
      await expect(main).toHaveAttribute("data-ordering-focus-count", "0");
      await menu.click();
      await navigation.getByRole("link", { name: "Public preview", exact: true }).click();
      await expect(navigation).toHaveCount(0);
      await expect(page).toHaveURL(/\/foundation$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "A shared language for the road",
      );
      if (await menu.isVisible()) {
        await expect(menu).toBeFocused();
        await expect(main).toHaveAttribute("data-ordering-focus-count", "0");
      } else {
        await expect(main).toBeFocused();
        await expect(main).toHaveAttribute("data-ordering-focus-count", "1");
      }
    }
    if (mobileNavigation) {
      phase = "MODIFIED_CLICK";
      await menu.click();
      const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
      await main.evaluate((element) => {
        element.dataset.orderingModifiedClick = "false";
        // Cancel native opening after React handles the real modified click.
        document.addEventListener(
          "click",
          (event) => {
            if (event.ctrlKey || event.metaKey) {
              element.dataset.orderingModifiedClick = "true";
              event.preventDefault();
            }
          },
          { once: true },
        );
      });
      await navigation
        .getByRole("link", { name: "Connection", exact: true })
        .click({ modifiers: ["ControlOrMeta"] });
      await expect(main).toHaveAttribute("data-ordering-modified-click", "true");
      await expect(navigation).toHaveCount(0);
      await expect(menu).toBeFocused();
      await page.getByRole("button", { name: "About this preview", exact: true }).click();
      await page
        .getByRole("dialog", { name: "About this preview", exact: true })
        .getByRole("link", { name: "Connection", exact: true })
        .click();
      await expect(page).toHaveURL(/\/status$/);
      await expect(main).toBeFocused();
    }
    phase = "NORMAL_ROUTE";
    await page.getByRole("link", { name: "Yukon Union", exact: true }).click();
    await expect(main).toBeFocused();
    if (mobileNavigation) {
      phase = "HASH_ROUTE";
      const publicMenu = page.getByRole("button", { name: "Открыть навигацию", exact: true });
      await main.evaluate((element) => {
        element.dataset.orderingFocusCount = "0";
      });
      await publicMenu.click();
      const navigation = page.getByRole("dialog", { name: "Навигация", exact: true });
      await navigation.getByRole("link", { name: "О компании", exact: true }).click();
      await expect(navigation).toHaveCount(0);
      await expect(publicMenu).toBeFocused();
      await expect(main).toHaveAttribute("data-ordering-focus-count", "0");
      phase = "AFTER_HASH";
      await main.getByRole("link", { name: "Публичные события", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Открытые конвои");
      await expect(main).toBeFocused();
    }
  } catch {
    throw new Error(`VTC019_FOCUS_${phase}_FAILED`);
  }
});

test("current-route menu selection and Escape restore the trigger while ordinary navigation focuses main", async ({
  page,
}) => {
  await page.goto("/foundation/member");
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Member workspace composition");
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  const hasMenu = await menu.isVisible();
  if (hasMenu) {
    await menu.focus();
    await page.keyboard.press("Enter");
    const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
    await navigation.getByRole("link", { name: "Member preview", exact: true }).click();
    await expect(navigation).toHaveCount(0);
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(navigation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigation).toHaveCount(0);
    await expect(menu).toBeFocused();
  }
  await page.getByRole("link", { name: "Yukon Union", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main")).toBeFocused();
});

test("an immediate menu activation after a history commit retains focus ownership across pending origin effects", async ({
  page,
}) => {
  await page.goto("/foundation");
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Member preview", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Member workspace composition");
  if (!(await menu.isVisible())) {
    await expect(page.getByRole("main")).toBeFocused();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A shared language for the road",
    );
    await expect(page.getByRole("main")).toBeFocused();
    return;
  }
  await menu.click();
  const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(navigation).toBeVisible();
  const observation = await page.evaluateHandle(
    () =>
      new Promise<{ counts: { before: number; after: number }; stop: () => void }>(
        (resolve, reject) => {
          const main = document.querySelector("main");
          if (!main) throw new Error("SYNTHETIC_MAIN_MISSING");
          const counts = { before: 0, after: 0 };
          let activated = false;
          const onFocus = (event: FocusEvent) => {
            if (event.target === main) counts[activated ? "after" : "before"]++;
          };
          document.addEventListener("focusin", onFocus, true);
          const observer = new MutationObserver(() => {
            if (
              location.pathname !== "/foundation" ||
              main.querySelector("h1")?.textContent !== "A shared language for the road"
            )
              return;
            observer.disconnect();
            const retainedLink = document.querySelector(
              '[role="dialog"] nav a[href="/foundation/member"]',
            );
            if (!(retainedLink instanceof HTMLAnchorElement)) {
              document.removeEventListener("focusin", onFocus, true);
              reject(new Error("SYNTHETIC_RETAINED_MENU_LINK_MISSING"));
              return;
            }
            activated = true;
            retainedLink.click();
            resolve({
              counts,
              stop: () => document.removeEventListener("focusin", onFocus, true),
            });
          });
          observer.observe(main, { childList: true, subtree: true, characterData: true });
          history.back();
        },
      ),
  );
  try {
    await expect(page).toHaveURL(/\/foundation\/member$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Member workspace composition",
    );
    await expect(navigation).toHaveCount(0);
    await expect(menu).toBeFocused();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await observation.evaluate(({ counts }) => counts)).toEqual({ before: 0, after: 0 });
  } finally {
    await observation.evaluate(({ stop }) => stop());
    await observation.dispose();
  }
  await page.getByRole("link", { name: "Yukon Union", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main")).toBeFocused();
});

for (const path of ["/foundation/member/", "/FoUnDaTiOn/MeMbEr"]) {
  test(`direct member variant ${path} preserves its location and member navigation`, async ({
    page,
  }, info) => {
    await page.goto(`${path}?preview=synthetic#main-content`);
    await expect(page).toHaveURL(/\/foundation\/member\?preview=synthetic#main-content$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Композиция кабинета участника",
    );
    const sidebar = page.getByRole("complementary", {
      name: "Пример рабочего пространства",
      exact: true,
    });
    const menu = page.getByRole("button", { name: "Открыть навигацию", exact: true });
    const mobileNavigation = await menu.isVisible();
    if ((page.viewportSize()?.width ?? 0) > 1050) {
      await expect(sidebar).toBeVisible();
    } else {
      await expect(sidebar).toBeHidden();
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Навигация", exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Пример кабинета", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("link", { name: "Публичный пример", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
    await noOverflow(page);
    await capture(page, info, "canonical-member-navigation");
    if (mobileNavigation) {
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
  });
}

test("dark public and member shells retain readable controls, bundled font/license and working navigation", async ({
  page,
}, info) => {
  const requested: string[] = [];
  const fontResponses: Response[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("response", (response) => {
    if (bundledFont.test(new URL(response.url()).pathname)) fontResponses.push(response);
  });
  await page.goto("/foundation/member");
  const origin = new URL(page.url()).origin;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Композиция кабинета участника");
  await page.evaluate(() => document.fonts.ready);
  for (const weight of [400, 700])
    expect(
      await page.evaluate(async (weight) => {
        const font = `${weight} 14px "Huninn"`;
        const faces = await document.fonts.load(font, "Язык · Yukon Union");
        return (
          document.fonts.check(font, "Язык · Yukon Union") &&
          faces.some(
            (face) => face.family.replaceAll('"', "") === "Huninn" && face.status === "loaded",
          )
        );
      }, weight),
    ).toBe(true);
  await expect(page.getByRole("main")).toHaveCSS("font-family", fontStack);
  const fonts = await Promise.all(
    fontResponses.map(async (response) => ({
      url: new URL(response.url()),
      status: response.status(),
      type: response.headers()["content-type"],
      bytes: (await response.body()).length,
    })),
  );
  expect(fonts.length).toBeGreaterThan(0);
  for (const font of fonts) {
    expect(font.url.origin).toBe(origin);
    expect(font.status).toBe(200);
    expect(font.type).toBe("font/woff2");
    expect(font.url.pathname).toMatch(/\/assets\/huninn-400-core-[^/]+\.woff2$/);
  }
  // One page's Latin/Cyrillic font bytes stay below the previous UI font's 73892-byte
  // per-page core maximum (its 400, 500 and 700 core subsets).
  expect(fonts.reduce((total, font) => total + font.bytes, 0)).toBeLessThan(73892);
  await page.evaluate(() => document.fonts.load('400 14px "Huninn"', "Łódź"));
  await expect
    .poll(() =>
      fontResponses.some((response) =>
        /\/assets\/huninn-400-ext-[^/]+\.woff2$/.test(new URL(response.url()).pathname),
      ),
    )
    .toBe(true);
  expect(
    requested.filter((url) => {
      const parsed = new URL(url);
      return !["data:", "blob:"].includes(parsed.protocol) && parsed.origin !== origin;
    }),
  ).toEqual([]);
  const license = await page
    .getByRole("link", { name: "Лицензия шрифта Huninn", exact: true })
    .getAttribute("href");
  expect(license).toMatch(/^\/assets\/OFL-[^/]+\.txt$/);
  const response = await page.request.get(license ?? "");
  expect(response.status()).toBe(200);
  expect(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  ).toBe("d71824aeb09afc4c2cac01acab5c3db79796e927ba37be40d69fb62a412639b6");
  const sidebar = page.getByRole("complementary", {
    name: "Пример рабочего пространства",
    exact: true,
  });
  if ((page.viewportSize()?.width ?? 0) > 1050) {
    await expect(sidebar).toBeVisible();
    const side = await sidebar.boundingBox(),
      content = await page.getByRole("main").boundingBox();
    expect(side && content && side.x + side.width <= content.x).toBeTruthy();
    expect(
      await sidebar
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    ).toEqual(["/", "/status", "/foundation", "/foundation/member"]);
  } else {
    await expect(sidebar).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Открыть навигацию", exact: true }),
    ).toBeVisible();
  }
  const note = page.getByRole("textbox", { name: "Текст примера", exact: true });
  const submit = page.getByRole("button", { name: "Показать подтверждение", exact: true });
  for (const target of [
    page.getByRole("heading", { level: 1 }),
    note,
    submit,
    page.getByRole("combobox", { name: "Состояние примера", exact: true }),
    page.getByRole("cell").filter({ hasText: "Завершён · принят" }).locator("[data-slot=badge]"),
  ])
    expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(note, "::placeholder")).toBeGreaterThanOrEqual(4.5);
  const outline = page.getByRole("button", { name: "Об этом примере", exact: true });
  for (const control of [
    note,
    page.getByRole("combobox", { name: "Состояние примера", exact: true }),
    outline,
  ]) {
    expect(await contrast(control, undefined, "borderTopColor")).toBeGreaterThanOrEqual(3);
    expect(await contrast(control, undefined, "borderTopColor", true)).toBeGreaterThanOrEqual(3);
  }
  await outline.hover();
  expect(await contrast(outline, undefined, "borderTopColor")).toBeGreaterThanOrEqual(3);
  expect(await contrast(outline, undefined, "borderTopColor", true)).toBeGreaterThanOrEqual(3);
  const period = page.getByRole("group", { name: "Период примера", exact: true });
  const segments = await period.getByRole("button").all();
  expect(segments).toHaveLength(3);
  await expect(period.locator('[aria-pressed="true"]')).toHaveCount(1);
  for (const segment of segments) expect(await contrast(segment)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(period, undefined, "borderTopColor")).toBeGreaterThanOrEqual(3);
  expect(await contrast(period, undefined, "borderTopColor", true)).toBeGreaterThanOrEqual(3);
  const tabs = await page
    .getByRole("tablist", { name: "Разделы примера", exact: true })
    .getByRole("tab")
    .all();
  expect(tabs).toHaveLength(2);
  for (const tab of tabs) expect(await contrast(tab)).toBeGreaterThanOrEqual(4.5);
  const activeTab = page.getByRole("tab", { name: "Обзор", exact: true, selected: true });
  expect(await contrast(activeTab, undefined, "borderBottomColor")).toBeGreaterThanOrEqual(3);
  expect(
    await contrast(page.getByRole("button", { name: "Открыть строку примера", exact: true })),
  ).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, "enabled-control-contrast");
  await note.fill("Синтетическая проверка контраста");
  await submit.click();
  const pending = page.getByRole("button", { name: "Готовим пример…", exact: true });
  await expect(pending).toBeDisabled();
  expect(await contrast(pending)).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByRole("status")).toHaveText(
    "Пример подтверждён локально. Действие компании не отправлено.",
  );
  await page.goto("/foundation");
  await expect(sidebar).toBeHidden();
  await noOverflow(page);
  await page.goto("/status");
  const previewLink = page
    .getByRole("main")
    .getByRole("link", { name: "Публичный пример", exact: true });
  await previewLink.hover();
  expect(await contrast(previewLink)).toBeGreaterThanOrEqual(4.5);
});

test("compact control sizes follow pointer type", async ({ page }, info) => {
  await page.goto("/foundation");
  await page.evaluate(() => document.fonts.ready);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(coarse).toBe(info.project.name === "mobile-chromium");
  const expectHeight = async (locator: Locator, fine: [number, number]) => {
    await expect(locator).toBeVisible();
    const value = (await locator.boundingBox())?.height ?? 0;
    if (coarse) expect(value).toBeGreaterThanOrEqual(40);
    else {
      expect(value).toBeGreaterThanOrEqual(fine[0] - 0.5);
      expect(value).toBeLessThanOrEqual(fine[1] + 0.5);
    }
  };
  await expectHeight(page.getByRole("button", { name: "Об этом примере", exact: true }), [30, 30]);
  await expectHeight(page.getByRole("button", { name: "Сохранить пример", exact: true }), [30, 30]);
  await expectHeight(page.getByRole("textbox", { name: "Текст примера", exact: true }), [32, 32]);
  await expectHeight(
    page.getByRole("combobox", { name: "Состояние примера", exact: true }),
    [32, 32],
  );
  const segments = await page
    .getByRole("group", { name: "Период примера", exact: true })
    .getByRole("button")
    .all();
  expect(segments).toHaveLength(3);
  for (const xs of [
    page.getByRole("button", { name: "Открыть строку примера", exact: true }),
    page.getByRole("combobox", { name: "Компактный фильтр", exact: true }),
    page.getByRole("textbox", { name: "Компактный поиск", exact: true }),
    ...segments,
  ])
    await expectHeight(xs, [24, 24]);
  const tabs = await page
    .getByRole("tablist", { name: "Разделы примера", exact: true })
    .getByRole("tab")
    .all();
  expect(tabs).toHaveLength(2);
  for (const tab of tabs) await expectHeight(tab, [32, 34]);
  const typography = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`MISSING_${selector}`);
      return getComputedStyle(element);
    };
    return {
      body: style("body").fontSize,
      h1: style("h1").fontSize,
      h1Weight: style("h1").fontWeight,
      th: style(".table th").fontSize,
      badge: style("[data-slot=badge]").fontSize,
    };
  });
  expect(typography).toEqual({
    body: "13px",
    h1: "18px",
    h1Weight: "600",
    th: "12px",
    badge: "11px",
  });
  await noOverflow(page);
  await capture(page, info, `compact-controls-${coarse ? "coarse" : "fine"}`);
});

test("CSS weights render the shipped font face with synthesized bold and aligned tabular digits", async ({
  page,
}) => {
  await page.goto("/foundation");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".table th").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Rendered arrows and symbols that the source font contains; see the subset README.
  const renderedSymbols = "←↑→↓—№∅◇●×•«»·–";
  await page.evaluate(async (symbols) => {
    const visible = Array.from(document.querySelectorAll(".wordmark")).find(
      (element) => element.getClientRects().length > 0,
    );
    visible?.setAttribute("data-font-probe", "wordmark");
    for (const [name, weight] of [
      ["numeric", ""],
      ["numeric-bold", "700"],
    ] as const) {
      const probe = document.createElement("span");
      probe.className = "numeric";
      probe.style.fontWeight = weight;
      probe.setAttribute("data-font-probe", name);
      probe.textContent = "0123456789";
      document.querySelector("main")?.append(probe);
    }
    for (const [name, text] of [
      ["symbols", symbols],
      // Rendered characters that the subset README leaves to the system fallback.
      ["fallback", "…↗✓✕"],
    ] as const) {
      const probe = document.createElement("span");
      probe.setAttribute("data-font-probe", name);
      probe.textContent = text;
      document.querySelector("main")?.append(probe);
    }
    await Promise.all(
      [400, 500, 700].map((weight) =>
        document.fonts.load(`${weight} 14px "Huninn"`, `Yukon 0123456789${symbols}`),
      ),
    );
  }, renderedSymbols);
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument", { depth: -1 });
  const platformFonts = async (selector: string) => {
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    expect(nodeId, selector).toBeGreaterThan(0);
    return (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
  };
  const faces = async (selector: string) =>
    (await platformFonts(selector))
      .filter((font) => font.isCustomFont)
      .map((font) => font.postScriptName);
  // Upstream PostScript name of the only face; 500 renders it regular, 600+ synthesize bold.
  for (const selector of [
    "main h1",
    "[data-font-probe=wordmark]",
    ".table th",
    "main .lead",
    "[data-font-probe=numeric]",
    "[data-font-probe=numeric-bold]",
  ])
    expect(await faces(selector), selector).toEqual(["Huninn-Regular"]);
  // Every rendered symbol comes from the core face; the centred-dot ellipsis and the
  // symbols the source font lacks stay in the system fallback.
  expect(
    (await platformFonts("[data-font-probe=symbols]")).map((font) => [
      font.postScriptName,
      font.isCustomFont,
      font.glyphCount,
    ]),
  ).toEqual([["Huninn-Regular", true, [...renderedSymbols].length]]);
  expect(await faces("[data-font-probe=fallback]")).toEqual([]);
  const declared = await page.evaluate(() => {
    const items: { weight: string; range: string }[] = [];
    const named: Record<string, string> = { normal: "400", bold: "700" };
    document.fonts.forEach((face) => {
      if (face.family.replaceAll('"', "") === "Huninn")
        items.push({ weight: named[face.weight] ?? face.weight, range: face.unicodeRange });
    });
    return items;
  });
  const inRange = (range: string, code: number) =>
    range.split(",").some((part) => {
      const [start = "", end = start] = part.trim().replace(/^U\+/i, "").split("-");
      return Number.parseInt(start, 16) <= code && code <= Number.parseInt(end, 16);
    });
  expect(declared).toHaveLength(2);
  expect(declared.map((face) => face.weight)).toEqual(["400", "400"]);
  const core = declared.filter((face) => inRange(face.range, 0x41));
  expect(core).toHaveLength(1);
  for (const symbol of renderedSymbols)
    expect(inRange(core[0]?.range ?? "", symbol.codePointAt(0) ?? 0), symbol).toBe(true);
  expect(declared.filter((face) => inRange(face.range, 0x2026))).toEqual([]);
  const result = await page.evaluate(() => {
    const spreads = ["numeric", "numeric-bold"].map((name) => {
      const probe = document.querySelector<HTMLElement>(`[data-font-probe=${name}]`);
      if (!probe) throw new Error("MISSING_PROBE");
      const widths = ["1111111111", "0000000000", "8888888888"].map((digits) => {
        probe.textContent = digits;
        return probe.getBoundingClientRect().width;
      });
      return {
        numeric: getComputedStyle(probe).fontVariantNumeric,
        spread: Math.max(...widths) - Math.min(...widths),
      };
    });
    const synthesis = (selector: string) => {
      const element = Array.from(document.querySelectorAll(selector)).find(
        (item) => item.getClientRects().length > 0,
      );
      return element ? getComputedStyle(element).fontSynthesisWeight : `MISSING_${selector}`;
    };
    return {
      synthesis: ["main h1", "main button", ".table th", ".wordmark"].map(synthesis),
      spreads,
    };
  });
  // Weight-400-only Huninn needs synthesized bold on headings, controls, headers and the wordmark.
  expect(result.synthesis).toEqual(["auto", "auto", "auto", "auto"]);
  expect(result.spreads).toHaveLength(2);
  for (const { numeric, spread } of result.spreads) {
    expect(numeric).toBe("tabular-nums");
    expect(spread).toBeLessThan(0.5);
  }
  // Huninn ships only weight 400, so weight 700 must render with visibly heavier synthesized
  // strokes. Ink is compared, not width. The canvas uses no app CSS, so this proves the
  // browser can synthesize bold for the face; the computed values above cover the app CSS.
  const ink = await page.evaluate(async () => {
    await document.fonts.load('700 32px "Huninn"', "Язык Yukon");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("MISSING_CANVAS");
    return [400, 700].map((weight) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = `${weight} 32px "Huninn"`;
      context.fillStyle = "#000";
      context.fillText("Язык Yukon", 8, 44);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let pixels = 0;
      for (let index = 3; index < data.length; index += 4)
        if ((data[index] ?? 0) > 127) pixels += 1;
      return pixels;
    });
  });
  expect(ink[0] ?? 0).toBeGreaterThan(0);
  expect(ink[1] ?? 0).toBeGreaterThanOrEqual((ink[0] ?? 0) * 1.05);
});

for (const locale of ["ru", "en"]) {
  test(`segmented control and tabs keyboard semantics ${locale}`, async ({ page }, info) => {
    await page.goto("/foundation");
    await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption(locale);
    const ru = locale === "ru";
    const group = page.getByRole("group", {
      name: ru ? "Период примера" : "Example period",
      exact: true,
    });
    const pressed = group.locator('[aria-pressed="true"]');
    await expect(pressed).toHaveCount(1);
    await expect(pressed).toHaveText(ru ? "Месяц" : "Month");
    await group.getByRole("button", { name: ru ? "Неделя" : "Week", exact: true }).click();
    await expect(pressed).toHaveCount(1);
    await expect(pressed).toHaveText(ru ? "Неделя" : "Week");
    const year = group.getByRole("button", { name: ru ? "Год" : "Year", exact: true });
    await year.focus();
    await page.keyboard.press("Space");
    await expect(year).toHaveAttribute("aria-pressed", "true");
    await expect(pressed).toHaveCount(1);
    const tablist = page.getByRole("tablist", {
      name: ru ? "Разделы примера" : "Example sections",
      exact: true,
    });
    const overview = tablist.getByRole("tab", { name: ru ? "Обзор" : "Overview", exact: true });
    const log = tablist.getByRole("tab", { name: ru ? "Журнал" : "Log", exact: true });
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await overview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(log).toBeFocused();
    await expect(log).toHaveAttribute("aria-selected", "true");
    await expect(overview).toHaveAttribute("aria-selected", "false");
    const logPanel = page.getByRole("tabpanel", { name: ru ? "Журнал" : "Log", exact: true });
    await expect(logPanel).toHaveText(
      ru ? "Панель журнала с вымышленной историей." : "Log panel with fictional history content.",
    );
    await page.keyboard.press("Home");
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel", { name: ru ? "Обзор" : "Overview", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("End");
    await expect(log).toBeFocused();
    await expect(log).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(logPanel).toBeFocused();
    await capture(page, info, `segmented-tabs-${locale}`);
  });
}

test("controlled font-download failure keeps the Cyrillic interface usable with the system fallback", async ({
  page,
}, info) => {
  let aborted = 0;
  await page.route(bundledFont, (route) => {
    aborted += 1;
    return route.abort("failed");
  });
  await page.goto("/foundation/member");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Композиция кабинета участника");
  expect(aborted).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.fonts.check('14px "Huninn"', "Язык"))).toBe(false);
  await expect(page.getByRole("main")).toHaveCSS("font-family", fontStack);
  await expect(page.getByRole("textbox", { name: "Текст примера", exact: true })).toBeVisible();
  await noOverflow(page);
  await capture(page, info, "font-unavailable-system-fallback");
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
