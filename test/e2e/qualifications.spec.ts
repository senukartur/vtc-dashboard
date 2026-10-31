import { mkdir, writeFile } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import {
  qualificationPhaseAnnotation,
  qualificationPhaseScenario,
  safeQualificationPhase,
} from "../../scripts/browser-diagnostics.mjs";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { mockQualifications } from "./support/qualifications.ts";

async function persistRace(
  info: TestInfo,
  state: Awaited<ReturnType<typeof mockQualifications>>,
  scenario: string,
  assertedCurrent: boolean,
) {
  const ledger = {
    scenario,
    assertedCurrent,
    events: state.raceEvents,
    heldStarted: state.heldStarted,
    heldFinished: state.heldFinished,
    serverLevelVersion: state.version,
    serverMemberVersion: state.memberVersion,
    commandVersions: state.etags.map((etag) => Number(/^"v(\d+)"$/.exec(etag)?.[1]) || null),
    replayUsesOriginalKey: state.keys.length > 1 ? state.keys[0] === state.keys[1] : null,
  };
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(info.outputPath("qualification-read-race.json"), JSON.stringify(ledger));
  await info.attach("qualification-read-race", {
    body: JSON.stringify(ledger),
    contentType: "application/json",
  });
}

test("controlled old levels response cannot replace a committed version and current rule pointer", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  let assertedCurrent = false;
  try {
    await page.goto("/account/qualifications");
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card.getByRole("button", { name: "Edit rules", exact: true }).click();
    const editor = card.locator("section").last();
    await editor.locator('[id^="mass-"]').fill("20");
    await editor.locator('[id^="reason-"]').fill("Fictional delayed level response");
    await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Publish rule version", exact: true }),
    ).toBeEnabled();
    state.deferNext = ["levels"];
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => state.heldStarted).toEqual(["levels"]);
    state.immediatePointer = "d3300000-0000-4000-8000-000000000004";
    await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card.getByText("Version: 2", { exact: true })).toBeVisible();
    await expect(card.getByText("20 kg", { exact: true })).toBeVisible();
    await state.releaseHeld();
    await editor.locator('[id^="level-name-"]').fill("Fictional retained version two");
    await expect(card.getByText("Version: 2", { exact: true })).toBeVisible();
    await expect(card.getByText("20 kg", { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Save name", exact: true })).toBeEnabled();
    expect(state.etags).toEqual(['"v1"']);
    assertedCurrent = true;
  } finally {
    await state.releaseHeld();
    await persistRace(info, state, "level", assertedCurrent);
  }
});

test("controlled promotion refresh must replace pre-command progress history and command ETag", async ({
  page,
}, info) => {
  let phase = "setup",
    primaryPhase = "none";
  const annotation = { type: qualificationPhaseAnnotation, description: "" };
  function mark(next: string) {
    phase = next;
    const value = safeQualificationPhase({
      scenario: qualificationPhaseScenario,
      phase,
      primaryPhase,
    });
    if (!value) throw new Error("INVALID_QUALIFICATION_PHASE");
    annotation.description = JSON.stringify(value);
  }
  function primaryFailure() {
    primaryPhase = phase;
    mark(phase);
  }
  mark("setup");
  info.annotations.push(annotation);
  const state = await mockQualifications(page).catch((error: unknown) => {
    primaryFailure();
    throw error;
  });
  let assertedCurrent = false;
  state.distinctAssignment = true;
  let releaseCommand = () => {};
  try {
    mark("initial-route");
    await page.goto("/account/qualifications");
    mark("initial-reason");
    await page.locator("#assignment-reason").fill("Fictional delayed promotion reads");
    state.memberCommitGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    mark("open-promotion");
    await page.getByRole("button", { name: "Confirm next-level promotion", exact: true }).click();
    mark("confirm-promotion");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    mark("command-arrived");
    await expect.poll(() => state.memberCommandArrived).toBe(1);
    state.deferNext = ["progress", "history"];
    mark("trigger-old-reads");
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    mark("old-reads-held");
    await expect.poll(() => state.heldStarted.length).toBe(2);
    mark("release-promotion");
    releaseCommand();
    mark("promotion-committed");
    await expect.poll(() => state.memberVersion).toBe(8);
    mark("release-old-reads");
    await state.releaseHeld();
    mark("promotion-dialog-settled");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    mark("current-level");
    await expect(
      page.getByRole("heading", { name: "Fictional driver_iii", exact: true }),
    ).toBeVisible();
    mark("promotion-disabled");
    await expect(
      page.getByRole("button", { name: "Confirm next-level promotion", exact: true }),
    ).toBeDisabled();
    const history = page
      .getByRole("heading", { name: "Assignment history", exact: true })
      .locator("..");
    mark("history-assignment");
    await expect(history).toContainText("d3200000-0000-4000-8000-000000000002");
    mark("history-level");
    await expect(history).toContainText("Fictional driver_iii");
    mark("assignment-purpose");
    await page.locator("#assignment-purpose").selectOption("administrative_correction");
    mark("assignment-level");
    await page.locator("#assignment-level").selectOption("d3400000-0000-4000-8000-000000000002");
    mark("open-assignment");
    await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
    mark("confirm-assignment");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    mark("assignment-dialog-settled");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    mark("command-etags");
    expect(state.etags).toEqual(['"v7"', '"v8"']);
    assertedCurrent = true;
  } catch (error) {
    primaryFailure();
    throw error;
  } finally {
    mark("finally-release-command");
    releaseCommand();
    mark("finally-release-held");
    await state.releaseHeld();
    mark("finally-persist-race");
    await persistRace(info, state, "member", assertedCurrent);
    mark("complete");
  }
});

test("controlled historical receipt must fence an old GET before reading the latest level", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  let assertedCurrent = false;
  try {
    await page.goto("/account/qualifications");
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card.getByRole("button", { name: "Edit rules", exact: true }).click();
    const editor = card.locator("section").last();
    await editor.locator('[id^="reason-"]').fill("Fictional original delayed receipt");
    await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
    state.immediatePointer = "d3300000-0000-4000-8000-000000000004";
    state.uncertain = true;
    await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    state.version = 3;
    state.rulePointer = "d3300000-0000-4000-8000-000000000005";
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(card.getByText("Version: 3", { exact: true })).toBeVisible();
    state.deferNext = ["levels"];
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => state.heldStarted).toEqual(["levels"]);
    state.version = 4;
    state.rulePointer = "d3300000-0000-4000-8000-000000000006";
    state.ruleMasses[state.rulePointer] = "40";
    await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
    await expect.poll(() => state.keys.length).toBe(2);
    await state.releaseHeld();
    await expect(
      editor.getByText("The server confirmed the change.", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Version: 4", { exact: true })).toBeVisible();
    await expect(card.locator(":scope > dl").getByText("40 kg", { exact: true })).toBeVisible();
    await expect(editor.getByRole("alert").getByText("40 kg", { exact: true })).toBeVisible();
    expect(state.keys).toEqual([state.keys[0], state.keys[0]]);
    expect(state.etags).toEqual(['"v1"', '"v1"']);
    await expect(
      editor.getByRole("button", { name: "Use reviewed version as draft baseline", exact: true }),
    ).toBeEnabled();
    assertedCurrent = true;
  } finally {
    await state.releaseHeld();
    await persistRace(info, state, "receipt", assertedCurrent);
  }
});

for (const locale of ["en", "ru"] as const)
  test(`controlled ${locale} external publication requires validated baseline review for rename and publication while retaining the draft`, async ({
    page,
  }, info) => {
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
      rename = editor.getByRole("button", {
        name: locale === "en" ? "Save name" : "Сохранить название",
        exact: true,
      }),
      preview = editor.getByRole("button", {
        name: locale === "en" ? "Evaluate sample" : "Проверить пример",
        exact: true,
      }),
      review = editor.getByRole("button", {
        name:
          locale === "en"
            ? "Use reviewed version as draft baseline"
            : "Использовать проверенную версию как основу проекта",
        exact: true,
      });
    await editor.locator('[id^="level-name-"]').fill("Fictional retained name");
    await editor.locator('[id^="mass-"]').fill("12");
    await editor.locator('[id^="count-"]').fill("3");
    await editor.locator('[id^="distance-"]').fill("101");
    await editor.locator('[id^="sample-mass-"]').fill("12");
    await editor.locator('[id^="reason-"]').fill("Fictional retained baseline rationale");
    await preview.click();
    await expect(publish).toBeEnabled();
    let release = () => {};
    state.ruleGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.rulePointer = "d3300000-0000-4000-8000-000000000004";
    state.version = 2;
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(
      card.getByText(locale === "en" ? "Version: 2" : "Версия: 2", { exact: true }).first(),
    ).toBeVisible();
    await expect(review).toBeDisabled();
    await expect(rename).toBeDisabled();
    await expect(publish).toBeDisabled();
    expect(state.keys).toEqual([]);
    release();
    await expect(review).toBeEnabled();
    await expect(editor.getByRole("alert")).toContainText(
      locale === "en" ? "Latest stored version: 2" : "Актуальная сохранённая версия: 2",
    );
    await expect(editor.getByRole("alert")).toContainText("10 kg");
    await editor.screenshot({
      path: info.outputPath(`qualification-baseline-review-${locale}.png`),
    });
    await review.click();
    await expect(review).toHaveCount(0);
    await expect(publish).toBeDisabled();
    for (const [field, value] of [
      ["mass", "12"],
      ["count", "3"],
      ["distance", "101"],
      ["sample-mass", "12"],
      ["reason", "Fictional retained baseline rationale"],
      ["level-name", "Fictional retained name"],
    ])
      await expect(editor.locator(`[id^="${field}-"]`)).toHaveValue(value as string);
    await rename.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: locale === "en" ? "Confirm" : "Подтвердить", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      card.getByText(locale === "en" ? "Version: 3" : "Версия: 3", { exact: true }),
    ).toBeVisible();
    await preview.click();
    await expect(publish).toBeEnabled();
    await publish.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: locale === "en" ? "Confirm" : "Подтвердить", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.etags).toEqual(['"v2"', '"v3"']);
    expect(state.previewInputs.at(-1)).toMatchObject({
      rules: [{ type: "max_mass", maxKg: "12" }],
      sample: { cargoMassKg: "12" },
    });
  });

test("controlled recovered rename retains the old rule baseline when a newly active pointer arrives with its receipt", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  const card = page
    .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
    .locator("..");
  await card.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = card.locator("section").last(),
    rename = editor.getByRole("button", { name: "Save name", exact: true }),
    publish = editor.getByRole("button", { name: "Publish rule version", exact: true }),
    preview = editor.getByRole("button", { name: "Evaluate sample", exact: true }),
    review = editor.getByRole("button", {
      name: "Use reviewed version as draft baseline",
      exact: true,
    });
  await editor.locator('[id^="level-name-"]').fill("Fictional original rename");
  await editor.locator('[id^="mass-"]').fill("12");
  await editor.locator('[id^="sample-mass-"]').fill("12");
  await editor.locator('[id^="reason-"]').fill("Fictional retained rules during rename");
  await preview.click();
  await expect(publish).toBeEnabled();
  state.renamePointer = "d3300000-0000-4000-8000-000000000004";
  state.uncertain = true;
  await rename.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "The result is uncertain.",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(card.getByText("Version: 2", { exact: true })).toBeVisible();
  await expect(review).toBeDisabled();
  await editor.locator('[id^="level-name-"]').fill("Fictional distinct retained rename");
  await expect(rename).toBeDisabled();
  await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
  await expect(editor.getByText("The server confirmed the change.", { exact: true })).toBeVisible();
  expect(state.keys).toEqual([state.keys[0], state.keys[0]]);
  expect(state.etags).toEqual(['"v1"', '"v1"']);
  await expect(review).toBeEnabled();
  await expect(editor.getByRole("alert")).toContainText("Latest stored version: 2");
  await expect(rename).toBeDisabled();
  await preview.click();
  await expect(publish).toBeDisabled();
  await expect(editor.locator('[id^="level-name-"]')).toHaveValue(
    "Fictional distinct retained rename",
  );
  await expect(editor.locator('[id^="mass-"]')).toHaveValue("12");
  await expect(editor.locator('[id^="reason-"]')).toHaveValue(
    "Fictional retained rules during rename",
  );
  await review.click();
  await expect(publish).toBeDisabled();
  await preview.click();
  await expect(publish).toBeEnabled();
  await publish.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.etags).toEqual(['"v1"', '"v1"', '"v2"']);
  await expect(review).toHaveCount(0);
});

test("controlled scheduled publication recovery uses the frozen future body and cannot adopt another newly active rule", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  const card = page
    .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
    .locator("..");
  await card.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = card.locator("section").last(),
    publish = editor.getByRole("button", { name: "Publish rule version", exact: true }),
    preview = editor.getByRole("button", { name: "Evaluate sample", exact: true }),
    review = editor.getByRole("button", {
      name: "Use reviewed version as draft baseline",
      exact: true,
    });
  await editor.locator('[id^="mass-"]').fill("12");
  await editor.locator('[id^="sample-mass-"]').fill("12");
  await editor.locator('[id^="reason-"]').fill("Fictional retained future publication");
  await editor.locator('[id^="mode-"]').selectOption("schedule");
  await editor.locator('[id^="effective-"]').fill("2099-01-01T12:00");
  await preview.click();
  await expect(publish).toBeEnabled();
  state.scheduledPointer = "d3300000-0000-4000-8000-000000000004";
  state.uncertain = true;
  await publish.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "The result is uncertain.",
  );
  await page.keyboard.press("Escape");
  await editor.locator('[id^="mode-"]').selectOption("immediate");
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(card.getByText("Version: 2", { exact: true })).toBeVisible();
  await expect(publish).toBeDisabled();
  await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
  await expect(editor.getByText("The server confirmed the change.", { exact: true })).toBeVisible();
  expect(state.keys).toEqual([state.keys[0], state.keys[0]]);
  expect(state.etags).toEqual(['"v1"', '"v1"']);
  expect(state.publications.map((body) => body.effectiveAt)).toEqual([
    "2099-01-01T12:00:00.000Z",
    "2099-01-01T12:00:00.000Z",
  ]);
  await expect(editor.locator('[id^="mode-"]')).toHaveValue("immediate");
  await expect(review).toBeEnabled();
  await expect(editor.getByRole("alert")).toContainText("Latest stored version: 2");
  await preview.click();
  await expect(publish).toBeDisabled();
  await expect(editor.locator('[id^="mass-"]')).toHaveValue("12");
  await expect(editor.locator('[id^="reason-"]')).toHaveValue(
    "Fictional retained future publication",
  );
  await review.click();
  await expect(publish).toBeDisabled();
  await preview.click();
  await expect(publish).toBeEnabled();
  await publish.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.etags).toEqual(['"v1"', '"v1"', '"v2"']);
  expect(state.publications.at(-1)).not.toHaveProperty("effectiveAt");
  await expect(review).toHaveCount(0);
});

test("controlled publication refresh rebases paged rule history without refetching its obsolete cursor", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  state.rulePaged = true;
  await page.goto("/account/qualifications");
  const card = page
    .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
    .locator("..");
  const history = card.getByText("Rule version history", { exact: true });
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect((await history.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(coarse ? 40 : 30);
  await history.click();
  await card.locator("details").getByRole("button", { name: "Next page", exact: true }).click();
  await expect(card.getByText("Effective now", { exact: true })).toBeVisible();
  expect(state.ruleRequests).toContain("1:synthetic-rule-next");
  await card.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = card.locator("section").last();
  await editor.locator('[id^="reason-"]').fill("Fictional cursor refresh");
  await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Publish rule version", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(editor.getByText("The server confirmed the change.", { exact: true })).toBeVisible();
  await expect(card.locator("details")).toHaveJSProperty("open", false);
  await card.getByText("Rule version history", { exact: true }).click();
  await expect.poll(() => state.ruleRequests.at(-1)).toBe("2:");
  expect(state.ruleRequests.filter((request) => request.startsWith("2:"))).toEqual(["2:"]);
});

test("controlled uncertain own Trainee promotion refreshes its session on original receipt recovery after eligibility changes", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  await page.locator("#assignment-reason").fill("Fictional own promotion");
  state.uncertain = true;
  await page.getByRole("button", { name: "Confirm next-level promotion", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "The result is uncertain.",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check the previous action", exact: true }),
  ).toBeVisible();
  const backgroundSelf = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/me" && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await backgroundSelf;
  await expect(
    page.getByRole("button", { name: "Confirm next-level promotion", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Fictional driver_iii", exact: true }),
  ).toBeVisible();
  const before = state.selfReads,
    key = state.keys[0],
    etag = state.etags[0];
  await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
  await expect(page.getByText("The server confirmed the change.", { exact: true })).toBeVisible();
  await expect.poll(() => state.selfReads).toBe(before + 1);
  expect(state.keys).toEqual([key, key]);
  expect(state.etags).toEqual([etag, etag]);
});

test("controlled historical publication receipt cannot replace a newer refreshed level", async ({
  page,
}) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  const card = page
    .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
    .locator("..");
  await card.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = card.locator("section").last();
  await editor.locator('[id^="reason-"]').fill("Fictional original publication intent");
  await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
  state.uncertain = true;
  await editor.getByRole("button", { name: "Publish rule version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  state.version = 3;
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(card.getByText("Version: 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Check the previous action", exact: true }).click();
  await expect(editor.getByText("The server confirmed the change.", { exact: true })).toBeVisible();
  await expect(card.getByText("Version: 3", { exact: true })).toBeVisible();
  expect(state.keys).toEqual([state.keys[0], state.keys[0]]);
  expect(state.etags).toEqual(['"v1"', '"v1"']);
  await expect(editor.locator('[id^="reason-"]')).toHaveValue(
    "Fictional original publication intent",
  );
  await expect(
    editor.getByRole("button", { name: "Use reviewed version as draft baseline", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Publish rule version", exact: true }),
  ).toBeDisabled();
});

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
    await page.locator("#assignment-reason").fill("Fictional reviewed promotion context");
    await page
      .getByRole("button", {
        name:
          locale === "en"
            ? "Confirm next-level promotion"
            : "Подтвердить повышение на следующий уровень",
        exact: true,
      })
      .click();
    const promotionDialog = page.getByRole("dialog");
    await expect(
      promotionDialog.getByText(locale === "en" ? "Target member" : "Участник операции", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      promotionDialog.getByText("Fictional Yukon Member", { exact: true }),
    ).toBeVisible();
    await expect(promotionDialog.getByText(fixtureId, { exact: true })).toBeVisible();
    await expect(
      promotionDialog.getByText("d3400000-0000-4000-8000-000000000002", { exact: true }),
    ).toBeVisible();
    await expect(promotionDialog).toContainText(
      locale === "en" ? "Progression stage: Driver III" : "Ступень квалификации: Водитель III",
    );
    await promotionDialog.screenshot({
      path: info.outputPath(`qualification-promotion-context-${locale}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(promotionDialog).toHaveCount(0);
    await page.locator("#assignment-reason").fill("");
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
    await editor.locator('[id^="level-name-"]').fill("Fictional renamed stage");
    await editor
      .getByRole("button", {
        name: locale === "en" ? "Save name" : "Сохранить название",
        exact: true,
      })
      .click();
    const renameDialog = page.getByRole("dialog");
    await expect(
      renameDialog.getByText("d3400000-0000-4000-8000-000000000001", { exact: true }),
    ).toBeVisible();
    await expect(renameDialog).toContainText(
      locale === "en" ? "ETS2 · Progression stage: Trainee" : "ETS2 · Ступень квалификации: Стажёр",
    );
    await renameDialog.screenshot({
      path: info.outputPath(`qualification-rename-context-${locale}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(renameDialog).toHaveCount(0);
    await editor.locator('[id^="level-name-"]').fill("Fictional trainee");
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
    await expect(
      dialog.getByText("d3400000-0000-4000-8000-000000000001", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      locale === "en" ? "ETS2 · Progression stage: Trainee" : "ETS2 · Ступень квалификации: Стажёр",
    );
    await dialog.screenshot({
      path: info.outputPath(`qualification-publication-context-${locale}.png`),
    });
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
}, info) => {
  const state = await mockQualifications(page);
  await page.goto("/account/qualifications");
  await page.locator("#assignment-purpose").selectOption("administrative_correction");
  await page.locator("#assignment-level").selectOption("d3400000-0000-4000-8000-000000000001");
  await page.locator("#assignment-reason").fill("Fictional retained assignment intent");
  state.uncertain = true;
  await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Fictional Yukon Member", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByText(fixtureId, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("d3400000-0000-4000-8000-000000000001", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .screenshot({ path: info.outputPath("qualification-assignment-context.png") });
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
  await expect(
    page.getByRole("dialog").getByText("Fictional Yukon Member", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByText(fixtureId, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("d3400000-0000-4000-8000-000000000002", { exact: true }),
  ).toBeVisible();
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
}, info) => {
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
  await page.locator("#assignment-purpose").selectOption("historical_resolution");
  await page.locator("#assignment-level").selectOption("d3400000-0000-4000-8000-000000000001");
  await page.locator("#assignment-start").fill("2025-01-01T00:00");
  await page.locator("#assignment-end").fill("2025-02-01T00:00");
  await page.locator("#assignment-reason").fill("Fictional supported historical interval");
  await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(second, { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Fictional Duplicate Name — длинное имя участника", { exact: true }),
  ).toBeVisible();
  await dialog.screenshot({ path: info.outputPath("qualification-named-target-context.png") });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
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
