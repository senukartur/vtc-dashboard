import { expect, test } from "../e2e/support/fixtures.ts";
import { deliberateFailure } from "../support/failure-proof.ts";

test("VTC008_E2E_ASSERTION_PROBE", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("Приложение и база данных подключены", { exact: true }),
  ).toBeVisible();
  deliberateFailure("e2e");
});
