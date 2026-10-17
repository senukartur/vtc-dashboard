import { expect, test } from "../e2e/support/fixtures.ts";

test("VTC008_E2E_ASSERTION_PROBE", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("Приложение и база данных подключены", { exact: true }),
  ).toBeVisible();
  expect("VTC008_E2E_ASSERTION_PROBE").toBe("deliberately different");
});
