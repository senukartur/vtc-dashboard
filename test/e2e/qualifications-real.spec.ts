import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
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
async function confirm(page: Page, label: string, scope: Page | Locator = page) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("real four configured levels publish and assign within the unchanged shared read budget without intermediate resets", async ({
  page,
  context,
}, info) => {
  const fixture = await tripBrowserFixture(),
    staff = await staffContext();
  const reads: {
      operation: string;
      phase: string;
      status: number | null;
      minute: number | null;
    }[] = [],
    pending = new Map<object, number>();
  let phase = "FIXTURE",
    failure: unknown,
    authenticated = false,
    persistedAssignment = false;
  const operation = (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/me" || path.startsWith("/api/v1/me/")) return "self";
    if (path === "/api/v1/admin/qualification-members") return "targets";
    if (
      path.startsWith("/api/v1/qualification-levels") ||
      path.startsWith("/api/v1/admin/qualification-levels")
    )
      return "levels_or_rules";
    if (/^\/api\/v1\/admin\/members\/[^/]+\/qualification-/.test(path))
      return "target_progress_or_history";
    return null;
  };
  let capture = false,
    userId = "";
  page.on("request", (request) => {
    const kind = request.method() === "GET" ? operation(request.url()) : null;
    if (capture && kind) {
      pending.set(request, reads.length);
      reads.push({ operation: kind, phase, status: null, minute: null });
    }
  });
  page.on("response", (response) => {
    const index = pending.get(response.request()),
      row = index === undefined ? undefined : reads[index];
    if (row) {
      row.status = response.status();
      const date = Date.parse(response.headers().date ?? "");
      row.minute = Number.isFinite(date) ? Math.floor(date / 60000) : null;
    }
  });
  try {
    const identity = fixture.composed.identity,
      q = fixture.composed.qualifications;
    if (!q) throw Error("QUALIFICATION_NORMAL_COMPOSITION_MISSING");
    for (const level of (await q.levels(fixture.staff, "ets2")).items)
      await q.publish(fixture.staff, level.id, randomUUID(), level.version, {
        rules: [{ type: "max_mass", maxKg: "20000" }],
        requiredTrips: 2,
        requiredDistanceM: "100",
        reason: "Fictional four-level configuration",
      });
    expect(
      (await q.levels(fixture.staff, "ets2")).items.filter((level) => level.configured),
    ).toHaveLength(4);
    userId = `00000000-0000-4000-8000-${randomUUID().replaceAll("-", "").slice(-12)}`;
    const name = `Fictional bounded qualification ${info.project.name}`,
      credential = await identity.prepareCredential(fixture.password);
    await fixture.unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email: `${userId}@example.invalid`,
        name,
        roles: ["trainee", "dispatcher"],
        ...credential,
      }),
    );
    expect(
      (await q.members(fixture.staff, { limit: 25 })).items.some((member) => member.id === userId),
    ).toBe(true);
    await context.addCookies((await staff.storageState()).cookies);
    // One fixture boundary precedes every UI read; the ordinary flow has no reset or pacing.
    await resetAccountLimits();
    capture = true;
    phase = "TARGET";
    await page.goto("/account/qualifications");
    await catalogLanguage(page);
    await page.getByRole("combobox", { name: "Member", exact: true }).selectOption({ label: name });
    await expect(
      page.getByText("No current assignment is recorded for this game.", { exact: true }),
    ).toBeVisible();
    phase = "PUBLISH";
    const otherCard = page
      .getByRole("heading", { name: "Driver III · ETS2", exact: true })
      .locator("..");
    await otherCard.getByRole("button", { name: "Edit rules", exact: true }).click();
    const otherDraft = otherCard.locator("section").last();
    await otherDraft.locator('[id^="reason-"]').fill("Fictional unrelated preserved draft");
    const card = page.getByRole("heading", { name: "Trainee · ETS2", exact: true }).locator("..");
    await card.getByText("Rule version history", { exact: true }).click();
    await card.getByRole("button", { name: "Edit rules", exact: true }).click();
    const editor = card.locator("section").last();
    await editor.locator('[id^="mass-"]').fill("25000");
    await editor.locator('[id^="sample-mass-"]').fill("25000");
    await editor.locator('[id^="reason-"]').fill("Fictional normal publication");
    await editor.getByRole("button", { name: "Evaluate sample", exact: true }).click();
    await expect(
      editor.getByRole("heading", { name: "Sample outcome: Pass", exact: true }),
    ).toBeVisible();
    await confirm(page, "Publish rule version", editor);
    await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional normal publication");
    await expect(otherDraft.locator('[id^="reason-"]')).toHaveValue(
      "Fictional unrelated preserved draft",
    );
    await card.getByText("Rule version history", { exact: true }).click();
    const published = (await q.levels(fixture.staff, "ets2")).items.find(
      (level) => level.id === structuralLevels.ets2[0],
    );
    if (!published?.ruleVersionId) throw Error("QUALIFICATION_NORMAL_PUBLICATION_MISSING");
    await expect(card.locator("details")).toContainText(published.ruleVersionId);
    await expect(card.locator("details").locator("article").first()).toContainText("25000 kg");
    phase = "ASSIGN";
    await page.locator("#assignment-level").selectOption(structuralLevels.ets2[0]);
    await page.locator("#assignment-reason").fill("Fictional normal assignment");
    await confirm(page, "Assign qualification");
    phase = "READBACK";
    const history = page
      .getByRole("heading", { name: "Assignment history", exact: true })
      .locator("..");
    await expect(history).toContainText("Initial assignment");
    await expect(
      page.getByText("The server confirmed the change.", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Qualification administration", exact: true }),
    ).toBeVisible();
    await expect(otherDraft.locator('[id^="reason-"]')).toHaveValue(
      "Fictional unrelated preserved draft",
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      const me = await page.request.get("/api/v1/me"),
        date = Date.parse(me.headers().date ?? "");
      reads.push({
        operation: "final_self",
        phase: "FINAL_SELF",
        status: me.status(),
        minute: Number.isFinite(date) ? Math.floor(date / 60000) : null,
      });
      authenticated =
        me.status() === 200 && (await me.json()).data.member.id === fixture.staff.userId;
      const q = fixture.composed.qualifications;
      if (q && userId)
        persistedAssignment = (
          await q.history(fixture.staff, userId, "ets2", {}, true)
        ).data.items.some((row) => row.levelId === structuralLevels.ets2[0]);
      const ledger = {
        phase,
        completed: !failure,
        authenticated,
        persistedAssignment,
        totalSharedBucketReads: reads.length,
        reads,
      };
      await mkdir(info.outputDir, { recursive: true });
      await writeFile(
        info.outputPath("qualification-normal-read-budget.json"),
        JSON.stringify(ledger),
      );
      await info.attach("qualification-normal-read-budget", {
        body: JSON.stringify(ledger),
        contentType: "application/json",
      });
      console.log(
        JSON.stringify({
          event: "qualification_normal_read_budget",
          phase,
          completed: !failure,
          authenticated,
          persistedAssignment,
          total: reads.length,
          limited: reads.filter((row) => row.status === 429).length,
        }),
      );
    } finally {
      await staff.dispose();
      await fixture.close();
    }
  }
  expect(
    reads.length,
    "all shared-bucket GETs fit even if the flow crosses a minute boundary",
  ).toBeLessThanOrEqual(20);
  expect(reads.filter((row) => row.status === 429)).toEqual([]);
  if (failure) throw new Error(`SYNTHETIC_QUALIFICATION_NORMAL_${phase}`, { cause: failure });
  expect(authenticated).toBe(true);
  expect(persistedAssignment).toBe(true);
});
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
