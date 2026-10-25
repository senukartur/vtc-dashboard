import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import { resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { tripBrowserFixture } from "./support/trips.ts";

test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("real named target rule preview publication assignment accepted contributions and explicit promotion preserve ATS and additive roles", async ({
  page,
  context,
}, info) => {
  test.setTimeout(150000);
  await resetAccountLimits();
  const fixture = await tripBrowserFixture(),
    staff = await staffContext();
  let phase = "MEMBER";
  try {
    const identity = fixture.composed.identity,
      q = fixture.composed.qualifications,
      manual = fixture.composed.manualReports,
      decisions = fixture.composed.tripDecisions;
    if (!q || !manual || !decisions) throw Error("QUALIFICATION_BROWSER_COMPOSITION_MISSING");
    const userId = randomUUID(),
      email = `${userId}@example.invalid`,
      name = `Fictional Qualification ${info.project.name}`,
      credential = await identity.prepareCredential(fixture.password);
    await fixture.unit.run(async (tx) => {
      await identity.insertWithCredential(tx, {
        userId,
        email,
        name,
        roles: ["trainee", "dispatcher"],
        ...credential,
      });
      await createQualificationInitialization(fixture.unit).initialize(tx, {
        userId,
        games: ["ats"],
        assignedAt: new Date(Date.now() - 86400000).toISOString(),
      });
    });
    const login = await identity.login(email, fixture.password),
      cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; "),
      author = await identity.authenticate(new Headers({ cookie }));
    const beforeATS = await q.history(fixture.staff, userId, "ats", {}, true);
    await context.addCookies((await staff.storageState()).cookies);
    await page.goto("/account/qualifications");
    await catalogLanguage(page);
    phase = "NAMED_TARGET";
    const select = page.getByRole("combobox", { name: "Member", exact: true }),
      picker = select.locator("..");
    for (
      let i = 0;
      i < 20 && (await select.getByRole("option").filter({ hasText: name }).count()) === 0;
      i++
    ) {
      const next = picker.getByRole("button", { name: "Next page", exact: true });
      if (await next.isDisabled()) break;
      await next.click();
      await expect(picker.getByRole("status")).toHaveCount(0);
    }
    const option = select.getByRole("option").filter({ hasText: name });
    await expect(option).toHaveCount(1);
    await select.selectOption({ label: (await option.textContent()) ?? "" });
    await expect(
      page.getByText("No current assignment is recorded for this game.", { exact: true }),
    ).toBeVisible();
    await resetAccountLimits();
    phase = "RULES";
    await page.getByRole("button", { name: "Edit rules", exact: true }).first().click();
    const editor = page
      .locator("section")
      .filter({ has: page.locator('[id^="sample-mass-"]') })
      .last();
    await editor.locator('[id^="mass-"]').fill("25000");
    await editor.locator('[id^="count-"]').fill("1");
    await editor.locator('[id^="distance-"]').fill("100");
    await editor.locator('[id^="reason-"]').fill("Fictional qualification browser publication");
    await editor.locator('[id^="sample-mass-"]').fill("25000");
    await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
    await expect(
      editor.getByRole("heading", { name: "Sample outcome: Pass", exact: true }),
    ).toBeVisible();
    await confirm(page, "Publish rule version");
    phase = "ASSIGN";
    await page.locator("#assignment-level").selectOption(structuralLevels.ets2[0]);
    await page.locator("#assignment-reason").fill("Fictional first ETS2 assignment");
    await confirm(page, "Assign qualification");
    await resetAccountLimits();
    phase = "CONTRIBUTION";
    const bytes = pngBytes(),
      image = await manual.upload(
        author,
        randomUUID(),
        "synthetic-qualification.png",
        (async function* () {
          yield bytes;
        })(),
        "image/png",
      ),
      report = await manual.submitReport(author, randomUUID(), {
        fields: { ...fixture.fields, actualDistanceM: "100", evidenceIds: [image.id] },
      }),
      review = await decisions.review(fixture.staff, report.tripId);
    const reviewedRevisionId = review.data.trip.manualRevision?.id;
    if (!reviewedRevisionId) throw Error("QUALIFICATION_BROWSER_REVISION_MISSING");
    await decisions.decide(fixture.staff, report.tripId, randomUUID(), review.version, {
      decision: "accept",
      reviewedRevisionId,
      factRevisionId: review.data.factRevisionId,
      proposalId: null,
      reason: "Fictional accepted canonical contribution",
    });
    expect((await q.progress(fixture.staff, userId, "ets2", "admin")).data).toMatchObject({
      acceptedTrips: 1,
      actualDistanceM: "100",
      eligibleForConfirmation: true,
    });
    phase = "PROMOTION";
    await page.reload();
    await catalogLanguage(page);
    // Reload deliberately returns to the owned member; select the named target again.
    const target = page.getByRole("combobox", { name: "Member", exact: true });
    for (
      let i = 0;
      i < 20 && (await target.getByRole("option").filter({ hasText: name }).count()) === 0;
      i++
    ) {
      const next = target.locator("..").getByRole("button", { name: "Next page", exact: true });
      if (await next.isDisabled()) break;
      await next.click();
      await expect(target.locator("..").getByRole("status")).toHaveCount(0);
    }
    await target.selectOption({
      label: (await target.getByRole("option").filter({ hasText: name }).textContent()) ?? "",
    });
    await expect(
      page.getByText("Both thresholds are met. Staff confirmation is required.", { exact: true }),
    ).toBeVisible();
    await page.locator("#assignment-reason").fill("Fictional explicit next-level confirmation");
    await confirm(page, "Confirm next-level promotion");
    phase = "READBACK";
    const ets = await q.history(fixture.staff, userId, "ets2", {}, true),
      ats = await q.history(fixture.staff, userId, "ats", {}, true);
    expect(ets.data.items[0]?.levelId).toBe(structuralLevels.ets2[1]);
    expect(ets.data.items[1]?.endedAt).toBe(ets.data.items[0]?.assignedAt);
    expect(ats.data).toEqual(beforeATS.data);
    expect((await q.progress(fixture.staff, userId, "ets2", "admin")).data.acceptedTrips).toBe(0);
    phase = "ATTRIBUTION_RELOAD";
    await resetAccountLimits();
    await page.reload();
    await catalogLanguage(page);
    const reloadedTarget = page.getByRole("combobox", { name: "Member", exact: true });
    for (
      let i = 0;
      i < 20 && (await reloadedTarget.getByRole("option").filter({ hasText: name }).count()) === 0;
      i++
    ) {
      const next = reloadedTarget
        .locator("..")
        .getByRole("button", { name: "Next page", exact: true });
      if (await next.isDisabled()) break;
      await next.click();
      await expect(reloadedTarget.locator("..").getByRole("status")).toHaveCount(0);
    }
    await reloadedTarget.selectOption({
      label:
        (await reloadedTarget.getByRole("option").filter({ hasText: name }).textContent()) ?? "",
    });
    const history = page
        .getByRole("heading", { name: "Assignment history", exact: true })
        .locator(".."),
      staffName = (await identity.current(fixture.staff)).data.member.nickname;
    await expect(history).toContainText("Confirmed promotion");
    await expect(history).toContainText("Promotion confirmed");
    await expect(history).toContainText("Initial assignment");
    await expect(history).toContainText(staffName);
    await expect(history).toContainText(fixture.staff.userId);
    const actionResponse = await page.request.get(
      `/api/v1/admin/members/${userId}/qualification-action-history?game=ets2`,
    );
    expect(actionResponse.status()).toBe(200);
    const actions = (await actionResponse.json()).data.items;
    expect(actions[0]).toMatchObject({
      id: ets.data.items[0]?.id,
      purpose: "promotion",
      actor: { id: fixture.staff.userId, nickname: staffName },
      promotion: { id: expect.any(String), confirmedAt: expect.any(String) },
    });
    await expect(history).toContainText(actions[0].promotion.id);
    const ruleCard = page
      .getByRole("heading", { name: /Trainee · ETS2|Стажёр · ETS2/ })
      .locator("..");
    await ruleCard.getByText("Rule version history", { exact: true }).click();
    await expect(ruleCard).toContainText("Recorded publisher");
    await expect(ruleCard).toContainText(staffName);
    await expect(ruleCard).toContainText(fixture.staff.userId);
    const ruleResponse = await page.request.get(
      `/api/v1/admin/qualification-levels/${structuralLevels.ets2[0]}/rule-versions`,
    );
    expect(ruleResponse.status()).toBe(200);
    expect((await ruleResponse.json()).data.items[0].publisher).toEqual({
      id: fixture.staff.userId,
      nickname: staffName,
    });
    await resetAccountLimits();
    await context.clearCookies();
    await write(page.request, "/auth/login", { email, password: fixture.password });
    await page.goto("/account/qualifications");
    await catalogLanguage(page);
    await expect(
      page.getByRole("heading", { name: "Qualification administration", exact: true }),
    ).toHaveCount(0);
    const self = (await (await page.request.get("/api/v1/me")).json()).data;
    expect(self.member.roles.sort()).toEqual(["dispatcher", "driver"]);
    expect((await page.request.get("/api/v1/admin/qualification-members")).status()).toBe(403);
    expect(
      (
        await page.request.get(
          `/api/v1/admin/members/${userId}/qualification-action-history?game=ets2`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(
          `/api/v1/admin/qualification-levels/${structuralLevels.ets2[0]}/rule-versions`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await write(page.request, "/admin/qualification-rule-previews", {
          game: "ets2",
          rules: [],
          sample: {
            cargoMassKg: null,
            trailerTypeIds: [],
            trailersComplete: false,
            adr: { status: "unknown", entityId: null },
          },
        })
      ).status(),
    ).toBe(403);
    await page.getByLabel("Game", { exact: true }).selectOption("ats");
    await expect(
      page.getByRole("heading", { name: "Current qualification · ATS", exact: true }),
    ).toBeVisible();
  } catch (error) {
    throw new Error(`SYNTHETIC_QUALIFICATION_BROWSER_${phase}`, { cause: error });
  } finally {
    await staff.dispose();
    await fixture.close();
  }
});
