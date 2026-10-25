import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { mockQualifications } from "./support/qualifications.ts";

for (const locale of ["en", "ru"] as const)
  test(`controlled qualification ${locale} current rules exact progress editor preview and confirmations`, async ({
    page,
  }, info) => {
    await mockQualifications(page, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en" ? "Qualifications" : "Квалификации",
    );
    await expect(page.getByText("100.000000000000000001 / 100", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`qualifications-${locale}.png`),
      fullPage: true,
    });
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card
      .getByRole("button", {
        name: locale === "en" ? "Edit rules" : "Редактировать правила",
        exact: true,
      })
      .click();
    const editor = card.locator("section").last();
    const preview = editor.getByRole("button", {
        name: locale === "en" ? "Evaluate sample" : "Проверить пример",
        exact: true,
      }),
      publish = editor.getByRole("button", {
        name: locale === "en" ? "Publish rule version" : "Опубликовать версию правил",
        exact: true,
      });
    await expect(publish).toBeDisabled();
    await editor.locator('[id^="reason-"]').fill("Fictional draft rationale");
    await editor.locator('[id^="mass-"]').fill("100000000000000000000");
    await expect(preview).toBeDisabled();
    await editor.locator('[id^="mass-"]').fill("10");
    await editor.locator('[id^="sample-mass-"]').fill("11");
    await preview.click();
    await expect(
      editor.getByText(
        locale === "en" ? "Cargo mass exceeds the maximum." : "Масса груза превышает максимум.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(publish).toBeEnabled();
    await editor.locator('[id^="sample-mass-"]').fill("10");
    await expect(publish).toBeDisabled();
    await preview.click();
    await expect(publish).toBeEnabled();
    await publish.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const focus = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(focus).toBe(true);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(publish).toBeFocused();
    await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional draft rationale");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await editor.screenshot({ path: info.outputPath(`qualification-editor-${locale}.png`) });
  });

test("controlled uncertain publication retains the original key and draft; recoverable conflict preserves inputs", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  const card = page
    .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
    .locator("..");
  await card.getByText("Rule version history", { exact: true }).click();
  await expect(card.getByText("Historical version", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Scheduled version", {
      exact: true,
    }),
  ).toBeVisible();
  await card.screenshot({ path: info.outputPath("qualification-version-history.png") });
  await card.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = card.locator("section").last();
  await editor.locator('[id^="reason-"]').fill("Fictional preserved rationale");
  await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
  state.uncertain = true;
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(card.getByText("Version: 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.keys.length).toBe(2);
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.etags).toEqual(['"v1"', '"v1"']);
  expect(state.version).toBe(2);
  await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional preserved rationale");
  await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
  state.publishStatus = 409;
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional preserved rationale");
  state.publishStatus = 429;
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Too many requests.");
  await expect(page.getByRole("dialog").getByRole("button").first()).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.getByText(/Retry in \d seconds\./)).toBeVisible();
  await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional preserved rationale");
});

test("controlled assignment uncertain receipt retains command ETag after background progress refresh", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  await page.locator("#assignment-purpose").selectOption("administrative_correction");
  await page.locator("#assignment-level").selectOption("d3400000-0000-4000-8000-000000000001");
  await page.locator("#assignment-reason").fill("Fictional retained assignment intent");
  state.uncertain = true;
  await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => r.url().includes("qualification-progress") && r.headers().etag === '"v8"',
  );
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await refreshed;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.keys).toHaveLength(2);
  expect(state.keys[1]).toBe(state.keys[0]);
  expect(state.etags).toEqual(['"v7"', '"v7"']);
  expect(state.memberVersion).toBe(8);
});

test("controlled loading and game change discard the obsolete pending progress read", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  let release = () => {};
  state.progressGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto("/account/qualifications");
  const current = page
    .getByRole("heading", { name: "Current qualification · ETS2", exact: true })
    .locator("..");
  await expect(current.getByRole("status")).toBeVisible();
  await current.screenshot({ path: info.outputPath("qualification-loading.png") });
  state.progressGate = null;
  await page.getByLabel("Game", { exact: true }).selectOption("ats");
  await expect(
    page.getByRole("heading", { name: "Current qualification · ATS", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Current qualification · ETS2", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("100.000000000000000001 / 100", { exact: false })).toBeVisible();
});

test("controlled committed promotion with lost response remains recoverable after eligibility changes", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  await page.locator("#assignment-reason").fill("Fictional original promotion confirmation");
  state.uncertain = true;
  await page.getByRole("button", { name: "Confirm next-level promotion", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => r.url().includes("qualification-progress") && r.headers().etag === '"v8"',
  );
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await refreshed;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm next-level promotion", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The server confirmed the change." }),
  ).toBeVisible();
  expect(state.keys).toHaveLength(2);
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.etags).toEqual(['"v7"', '"v7"']);
  expect(state.memberVersion).toBe(8);
  await page.screenshot({
    path: info.outputPath("qualification-confirmed-success.png"),
    fullPage: true,
  });
});

test("controlled duplicate names with identical UUID prefixes remain distinguishable before selection", async ({
  page,
}) => {
  await mockQualifications(page);
  await page.goto("/account/qualifications");
  const select = page.getByRole("combobox", { name: "Member", exact: true }),
    first = "d3100000-0000-4000-8000-000000000001",
    second = "d3100000-0000-4000-8000-000000000002";
  await expect(select.locator(`option[value="${first}"]`)).toContainText(first);
  await expect(select.locator(`option[value="${second}"]`)).toContainText(second);
  await select.selectOption(second);
  await expect(
    page.locator("p").filter({ hasText: "Selected member:" }).getByText(second, { exact: true }),
  ).toBeVisible();
});

test("controlled member permissions unset thresholds retained-review and unavailable states", async ({
  page,
}, info) => {
  const state = await mockQualifications(page, "en", false);
  state.unset = true;
  state.review = true;
  await page.goto("/account/qualifications");
  await expect(
    page.getByRole("heading", { name: "Qualification administration", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit rules", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Earlier promotion requirements are no longer met.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("2 / Unset", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("qualification-review-unset.png"),
    fullPage: true,
  });
  state.progressStatus = 503;
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({ path: info.outputPath("qualification-unavailable.png"), fullPage: true });
  state.progressStatus = 409;
  state.emptyHistory = true;
  await page.reload();
  await expect(
    page.getByText("No current assignment is recorded for this game.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No supported assignment intervals are recorded for this game.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("qualification-empty-setup.png"), fullPage: true });
  state.unconfigured = true;
  state.progressStatus = 200;
  await page.reload();
  await expect(
    page
      .getByText("No effective rules have been published. Launch configuration is incomplete.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("qualification-unconfigured.png"),
    fullPage: true,
  });
  await page.getByLabel("Game", { exact: true }).selectOption("ats");
  await expect(page).toHaveURL(/game=ats/);
  await expect(
    page.getByRole("heading", { name: "Current qualification · ATS", exact: true }),
  ).toBeVisible();
});
