import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { components } from "@vtc/contracts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import { resetAccountLimits, staffContext, write } from "./support/account.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";
import { manualReferenceTimes } from "./support/manual-reference.ts";
import { tripBrowserFixture } from "./support/trips.ts";

type S = components["schemas"];
const summaryPath = "/api/v1/me/workspace-summary?view=stage3";
const candidatesPath = "/api/v1/admin/promotion-candidates";
const historyPath = "/api/v1/admin/promotion-history";
const searchPath = "/api/v1/admin/qualification-members";
const promotionReason = "Fictional promotion after accepted trip";

async function read<T>(context: APIRequestContext, path: string): Promise<T> {
  const response = await context.get(path);
  expect(response.status(), path.split("?")[0]).toBe(200);
  return (await response.json()).data as T;
}

async function readyCounts(context: APIRequestContext) {
  const data = await read<S["WorkspaceStage3Summary"]>(context, summaryPath);
  if (!data.promotionsReady) throw new Error("PROMOTIONS_READY_MISSING");
  return data.promotionsReady;
}

test.use({ trace: "off", screenshot: "off", video: "off" });

test(
  "Live promotion consumes one ETS2 ready candidate and keeps the ATS assignment",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture();
    let staff: APIRequestContext | undefined;
    try {
      staff = await staffContext();
      const { identity, qualifications, manualReports, tripDecisions } = fixture.composed;
      if (!qualifications || !manualReports || !tripDecisions)
        throw new Error("PROMOTION_BROWSER_COMPOSITION_MISSING");
      const userId = randomUUID();
      const nickname = `Fictional Promotion ${userId.slice(-8)}`;
      const email = `${userId}@example.invalid`;
      const credential = await identity.prepareCredential(fixture.password);
      await fixture.unit.run(async (tx) => {
        await identity.insertWithCredential(tx, {
          userId,
          email,
          name: nickname,
          roles: ["trainee", "dispatcher"],
          ...credential,
        });
        await createQualificationInitialization(fixture.unit).initialize(tx, {
          userId,
          games: ["ets2", "ats"],
          assignedAt: new Date(Date.now() - 86400000).toISOString(),
        });
      });
      const beforeAts = (await qualifications.progress(fixture.staff, userId, "ats", "admin")).data;
      const countsBeforeTrip = await readyCounts(staff);
      const author = await fixtureActor(identity, email, fixture.password);
      const image = await manualReports.upload(
        author,
        randomUUID(),
        "synthetic-promotion.png",
        (async function* () {
          yield pngBytes();
        })(),
        "image/png",
      );
      const report = await manualReports.submitReport(author, randomUUID(), {
        fields: {
          ...fixture.fields,
          ...manualReferenceTimes,
          actualDistanceM: "20000",
          evidenceIds: [image.id],
        },
      });
      const review = await tripDecisions.review(fixture.staff, report.tripId);
      const reviewedRevisionId = review.data.trip.manualRevision?.id;
      if (!reviewedRevisionId) throw new Error("PROMOTION_BROWSER_REVISION_MISSING");
      await tripDecisions.decide(fixture.staff, report.tripId, randomUUID(), review.version, {
        decision: "accept",
        reviewedRevisionId,
        factRevisionId: review.data.factRevisionId,
        proposalId: null,
        reason: "Fictional accepted contribution",
      });

      const before = await readyCounts(staff);
      expect(before).toEqual({ ets2: countsBeforeTrip.ets2 + 1, ats: countsBeforeTrip.ats });
      const staged = await read<S["QualificationStage3PromotionCandidateList"]>(
        staff,
        `${candidatesPath}?game=ets2&status=eligible&limit=100`,
      );
      const row = staged.items.find((candidate) => candidate.member.id === userId);
      if (!row?.nextLevel) throw new Error("PROMOTION_BROWSER_CANDIDATE_MISSING");
      expect(row).toMatchObject({
        member: { nickname, id: userId },
        currentLevel: { id: structuralLevels.ets2[0], name: expect.any(String) },
        nextLevel: { id: structuralLevels.ets2[1], name: expect.any(String) },
        acceptedTrips: 1,
        actualDistanceM: "20000",
        eligible: true,
        eligibleSince: null,
      });
      const search = await read<S["QualificationStage3MemberSearchList"]>(
        staff,
        `${searchPath}?view=stage3&search=${encodeURIComponent(nickname)}`,
      );
      expect(search.items.map((member) => member.id)).toEqual([userId]);

      await context.addCookies((await staff.storageState()).cookies);
      await page.goto("/account/admin/promotions");
      await switchLanguage(page, "en");
      const navigation = page.getByRole("navigation", { name: "Main navigation" });
      await expect(
        navigation.getByRole("link", { name: `Promotions (ready: ${before.ets2 + before.ats})` }),
      ).toBeVisible();
      const table = page.getByRole("table", { name: "Promotion candidates" });
      const candidateRow = table.getByRole("row").filter({ hasText: nickname });
      await expect(candidateRow).toContainText("20 km / 0.1 km");
      await candidateRow.getByRole("button", { name: `Promote ${nickname}` }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm promotion" });
      await expect(dialog.getByText(userId, { exact: true })).toBeVisible();
      await expect(dialog).toContainText(`${row.currentLevel.name} → ${row.nextLevel.name}`);
      await dialog.getByRole("textbox", { name: "Reason" }).fill(promotionReason);

      const promotionPath = `/api/v1/admin/members/${userId}/promotions`;
      const receipt = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === promotionPath &&
          response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Confirm promotion" }).click();
      const committed = await receipt;
      expect(committed.status()).toBe(200);
      const sent = committed.request();
      expect(sent.headers()["if-match"]).toBe(`"v${row.version}"`);
      expect(sent.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(sent.postDataJSON()).toEqual({
        game: "ets2",
        assignmentId: row.assignmentId,
        targetLevelId: row.nextLevel.id,
        reason: promotionReason,
      });
      const assignment = ((await committed.json()) as S["EnvelopeAssignment"]).data;
      expect(assignment).toMatchObject({ game: "ets2", levelId: row.nextLevel.id });
      await expect(page.getByText(`${nickname} was promoted in ETS2.`)).toBeVisible();
      await expect(candidateRow).toHaveCount(0);

      const after = await readyCounts(staff);
      expect(after).toEqual({ ets2: before.ets2 - 1, ats: before.ats });
      const remaining = after.ets2 + after.ats;
      await expect(
        navigation.getByRole("link", {
          name: remaining ? `Promotions (ready: ${remaining})` : "Promotions",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (await qualifications.progress(fixture.staff, userId, "ats", "admin")).data.assignment,
      ).toEqual(beforeAts.assignment);

      await page
        .getByRole("navigation", { name: "Promotion views" })
        .getByRole("link", { name: "History", exact: true })
        .click();
      await page.getByRole("searchbox", { name: "Search by nickname" }).fill(nickname);
      await page.getByRole("combobox", { name: "Select a driver" }).selectOption(userId);
      const history = page.getByRole("table", { name: "Company qualification history" });
      await expect(history.getByRole("row").filter({ hasText: promotionReason })).toContainText(
        nickname,
      );
      await expect(history.getByRole("row").filter({ hasText: "Initial assignment" })).toHaveCount(
        1,
      );
      const actions = await read<S["QualificationStage3PromotionHistoryList"]>(
        staff,
        `${historyPath}?game=ets2&memberId=${userId}`,
      );
      expect(actions.items.map((item) => item.kind)).toEqual(["promotion", "assignment"]);
      expect(actions.items[0]).toMatchObject({
        member: { id: userId },
        reason: promotionReason,
        sourceAssignmentId: row.assignmentId,
        targetAssignmentId: assignment.id,
        actor: { id: fixture.staff.userId },
      });
      const member = await fixture.unit.run(async (tx) =>
        (await identity.memberSummariesInTransaction(tx, [userId])).get(userId),
      );
      expect(member?.roles).toEqual(expect.arrayContaining(["driver", "dispatcher"]));
      expect(member?.roles).not.toContain("trainee");
      await expectDeniedReads(page.request, fixture.email, fixture.password);
    } finally {
      await staff?.dispose();
      await fixture.close();
    }
  },
);

async function fixtureActor(
  identity: Awaited<ReturnType<typeof tripBrowserFixture>>["composed"]["identity"],
  email: string,
  password: string,
) {
  const login = await identity.login(email, password);
  const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return identity.authenticate(new Headers({ cookie }));
}

async function expectDeniedReads(context: APIRequestContext, email: string, password: string) {
  const login = await write(context, "/auth/login", { email, password });
  expect(login.status()).toBe(200);
  for (const path of [
    `${candidatesPath}?game=ets2`,
    historyPath,
    `${searchPath}?view=stage3&search=Fictional`,
  ])
    expect((await context.get(path)).status()).toBe(403);
  expect(await read<S["WorkspaceStage3Summary"]>(context, summaryPath)).not.toHaveProperty(
    "promotionsReady",
  );
}
