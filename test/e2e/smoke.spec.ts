import { expect, test } from "./support/fixtures.ts";

test("built SPA connects to real MySQL, switches RU/EN, retries and navigates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("page error"));
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "VTC Dashboard" })).toBeVisible();
  await expect(
    page.getByText("Приложение и база данных подключены", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("combobox", { name: "Язык" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByText("Application and database are connected", { exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse(
    (item) => item.url().endsWith("/health/ready") && item.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Check again" }).click();
  const actual = await response;
  expect(actual.status()).toBe(200);
  expect(await actual.json()).toEqual({ status: "ready" });
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Language" }).focus();
  await expect(page.getByRole("combobox", { name: "Language" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto("/synthetic-unknown-route");
  await expect(page.getByRole("heading", { name: "Этой страницы пока нет" })).toBeVisible();
  await page.getByRole("link", { name: "На главную" }).click();
  await expect(page.getByRole("heading", { name: "Своя компания. Общая дорога." })).toBeVisible();
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "VTC Dashboard" })).toBeVisible();
  await expect(
    page.getByText("Приложение и база данных подключены", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
