import { expect, test } from "./support/fixtures.ts";

test("supplemental controlled readiness pending, 503 and retry recovery", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready = false;
  await page.route("**/health/ready", async (route) => {
    await gate;
    await route.fulfill({
      status: ready ? 200 : 503,
      json: { status: ready ? "ready" : "not_ready" },
    });
  });
  try {
    await page.goto("/status");
    await expect(page.getByText("Проверяем подключение…", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Проверить снова", exact: true })).toBeDisabled();
    release();
    await expect(page.getByText("База данных пока недоступна", { exact: true })).toBeVisible();
    ready = true;
    await page.getByRole("button", { name: "Проверить снова", exact: true }).click();
    await expect(
      page.getByText("Приложение и база данных подключены", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

for (const failure of [
  "network",
  "invalid-json",
  "invalid-shape",
  "status-mismatch",
  "unexpected-status",
]) {
  test(`supplemental controlled readiness ${failure} stays an error until a real retry response`, async ({
    page,
  }) => {
    let recover = false;
    await page.route("**/health/ready", async (route) => {
      if (recover) {
        await route.fulfill({ status: 200, json: { status: "ready" } });
        return;
      }
      if (failure === "network") await route.abort("failed");
      else if (failure === "invalid-json")
        await route.fulfill({ status: 200, contentType: "application/json", body: "{" });
      else if (failure === "invalid-shape")
        await route.fulfill({
          status: 200,
          json: { status: "unknown", privateDiagnostic: "must never appear" },
        });
      else if (failure === "status-mismatch")
        await route.fulfill({ status: 503, json: { status: "ready" } });
      else await route.fulfill({ status: 500, json: { status: "ready" } });
    });
    await page.goto("/status");
    await expect(
      page.getByText("Не удалось связаться с приложением", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Приложение и база данных подключены", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("must never appear", { exact: true })).toHaveCount(0);
    recover = true;
    await page.getByRole("button", { name: "Проверить снова", exact: true }).click();
    await expect(
      page.getByText("Приложение и база данных подключены", { exact: true }),
    ).toBeVisible();
  });
}
