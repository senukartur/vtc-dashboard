import { randomUUID } from "node:crypto";
import type { APIRequestContext, Response } from "@playwright/test";
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

test(
  "Live ladder edits invalidate ETS2 promotion intent and expose archive history without changing ATS",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90_000);
    await resetAccountLimits();
    const fixture = await tripBrowserFixture();
    let staff: APIRequestContext | undefined;
    const { identity, qualifications } = fixture.composed;
    const ladderPath = "/api/v1/admin/qualification-ladders/ets2";
    const suffix = randomUUID().slice(0, 8);
    const name = "Fictional next " + suffix;
    const sourceName = "Fictional source " + suffix;
    const nickname = "Fictional ladder driver " + suffix;
    const userId = randomUUID();
    const candidateList = (game: "ets2" | "ats") => candidatesPath + "?game=" + game;
    const promotionsPage = "/account/admin/promotions";
    const roles = () =>
      fixture.unit.run(async (tx) =>
        (await identity.memberSummariesInTransaction(tx, [userId])).get(userId)?.roles.toSorted(),
      );
    const candidate = async (api: APIRequestContext) =>
      (
        await read<S["QualificationStage3PromotionCandidateList"]>(
          api,
          candidateList("ets2") + "&limit=100",
        )
      ).items.find((row) => row.member.id === userId);
    const responseAt = (expected: string, method: string) => (response: Response) => {
      const { pathname, search } = new URL(response.url());
      return pathname + search === expected && response.request().method() === method;
    };
    let succeeded = false;
    let originalFirstId: string | undefined;
    let atsOnlyId: string | undefined;
    try {
      const api = await staffContext();
      staff = api;
      if (!qualifications) throw new Error("PROMOTION_BROWSER_COMPOSITION_MISSING");
      const original = await qualifications.ladder(fixture.staff, "ets2");
      const successor = original.data.levels[0];
      if (!successor) throw new Error("PROMOTION_BROWSER_LADDER_MISSING");
      originalFirstId = successor.id;
      await qualifications.changeLadder(fixture.staff, "ets2", randomUUID(), original.version, {
        type: "add",
        input: { position: 1, name: sourceName },
      });
      const source = (await qualifications.ladder(fixture.staff, "ets2")).data.levels[0];
      if (!source || source.name !== sourceName)
        throw new Error("PROMOTION_BROWSER_SOURCE_MISSING");
      await qualifications.publish(fixture.staff, source.id, randomUUID(), source.version, {
        rules: [],
        requiredTrips: 1,
        requiredDistanceM: null,
      });
      const credentials = await identity.prepareCredential(fixture.password);
      const initialize = createQualificationInitialization(fixture.unit);
      const secondDriver = randomUUID();
      await fixture.unit.run(async (tx) => {
        for (const member of [
          { id: userId, name: nickname, games: ["ets2", "ats"] as const },
          { id: secondDriver, name: "Fictional ATS fixture " + suffix, games: ["ats"] as const },
        ]) {
          await identity.insertWithCredential(tx, {
            userId: member.id,
            email: member.id + "@example.invalid",
            name: member.name,
            roles: ["trainee", "dispatcher"],
            ...credentials,
          });
          await initialize.initialize(tx, {
            userId: member.id,
            games: member.games,
            assignedAt: new Date(Date.now() - 86_400_000).toISOString(),
          });
        }
      });
      atsOnlyId = secondDriver;
      const atsStart = await qualifications.progress(fixture.staff, userId, "ats", "admin");
      const [ets2Page, atsPage] = await Promise.all(
        (["ets2", "ats"] as const).map((game) =>
          read<S["QualificationStage3PromotionCandidateList"]>(
            api,
            candidateList(game) + "&status=all&limit=1",
          ),
        ),
      );
      if (!ets2Page?.nextCursor || !atsPage?.nextCursor)
        throw new Error("PROMOTION_BROWSER_CURSOR_MISSING");
      const ets2Cursor = encodeURIComponent(ets2Page.nextCursor);
      const atsCursor = encodeURIComponent(atsPage.nextCursor);
      const atsBefore = await read<S["QualificationStage3PromotionCandidateList"]>(
        api,
        candidateList("ats") + "&status=all&limit=1&cursor=" + atsCursor,
      );
      const beforePublication = await readyCounts(api);
      await context.addCookies((await api.storageState()).cookies);
      await page.goto("/account/admin/settings?tab=qualifications");
      await switchLanguage(page, "en");
      const settings = page.getByRole("region", { name: "Qualification ladder" });
      const navigation = page.getByRole("navigation", { name: "Main navigation" });
      const attention = (count: number) =>
        navigation.getByRole("link", {
          name: count ? "Promotions (ready: " + count + ")" : "Promotions",
          exact: true,
        });
      await expect(attention(beforePublication.ets2 + beforePublication.ats)).toBeVisible();
      await settings.getByRole("button", { name: "Edit " + source.name, exact: true }).click();
      await settings.getByLabel("Minimum trips", { exact: true }).fill("");
      await settings.getByLabel("Minimum actual distance (km)", { exact: true }).fill("");
      await settings.getByRole("button", { name: "Publish rule version", exact: true }).click();
      const publishDialog = page.getByRole("dialog");
      const publication = page.waitForResponse(
        responseAt("/api/v1/admin/qualification-levels/" + source.id + "/rule-versions", "POST"),
      );
      const publishedSummary = page.waitForResponse(responseAt(summaryPath, "GET"));
      await publishDialog.getByRole("button", { name: "Confirm", exact: true }).click();
      expect((await publication).status()).toBe(201);
      const published = (
        (await (await publishedSummary).json()).data as S["WorkspaceStage3Summary"]
      ).promotionsReady;
      if (!published) throw new Error("PROMOTIONS_READY_MISSING");
      expect(published.ets2).toBe(beforePublication.ets2 + 1);
      expect(published.ats).toBe(beforePublication.ats);
      await expect(attention(published.ets2 + published.ats)).toBeVisible();
      const old = await candidate(api);
      if (!old?.nextLevel) throw new Error("PROMOTION_BROWSER_CANDIDATE_MISSING");
      expect(old.nextLevel.id).toBe(successor.id);

      await settings.getByLabel("Level name", { exact: true }).fill(name);
      await settings.getByLabel("Position", { exact: true }).selectOption(successor.id);
      await settings.getByRole("button", { name: "Add level", exact: true }).click();
      const add = page.waitForResponse(responseAt(ladderPath + "/levels", "POST"));
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      expect((await add).status()).toBe(201);
      const table = settings.getByRole("table", { name: "Qualification ladder" });
      await expect(table.getByRole("rowheader", { name: new RegExp(name) })).toBeVisible();
      const changed = await candidate(api);
      if (!changed?.nextLevel) throw new Error("PROMOTION_BROWSER_NEXT_MISSING");
      expect(changed.nextLevel.name).toBe(name);
      expect(changed.version).toBe(old.version + 1);
      expect(changed.assignmentId).toBe(old.assignmentId);
      const stale = await write(
        api,
        "/admin/members/" + userId + "/promotions",
        {
          game: "ets2",
          assignmentId: old.assignmentId,
          targetLevelId: old.nextLevel.id,
          reason: "Fictional stale review",
        },
        '"v' + old.version + '"',
      );
      expect(stale.status()).toBe(409);
      expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
      expect(
        await read<S["QualificationStage3PromotionCandidateList"]>(
          api,
          candidateList("ats") + "&status=all&limit=1&cursor=" + atsCursor,
        ),
      ).toEqual(atsBefore);

      const staleCursorResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === candidatesPath && url.searchParams.get("cursor") === ets2Page.nextCursor
        );
      });
      await page.goto(promotionsPage + "?game=ets2&tab=all&cursor=" + ets2Cursor);
      expect((await staleCursorResponse).status()).toBe(409);
      await expect(
        page.getByText("This page has expired. Return to the first page to continue."),
      ).toBeVisible();
      await page.getByRole("button", { name: "First page", exact: true }).click();
      await expect(page).toHaveURL(/game=ets2&tab=all$/);
      await page.getByRole("link", { name: "Ready", exact: true }).click();
      const driver = page
        .getByRole("table", { name: "Promotion candidates" })
        .getByRole("row")
        .filter({ hasText: nickname });
      await driver.getByRole("button", { name: "Promote " + nickname, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm promotion" });
      await expect(dialog).toContainText(source.name + " → " + name);
      await dialog.getByRole("textbox", { name: "Reason" }).fill(promotionReason);
      const promotion = page.waitForResponse(
        responseAt("/api/v1/admin/members/" + userId + "/promotions", "POST"),
      );
      await dialog.getByRole("button", { name: "Confirm promotion", exact: true }).click();
      const confirmed = await promotion;
      expect(confirmed.status()).toBe(200);
      expect(confirmed.request().headers()["if-match"]).toBe('"v' + changed.version + '"');
      expect(confirmed.request().postDataJSON()).toMatchObject({
        targetLevelId: changed.nextLevel.id,
        assignmentId: changed.assignmentId,
      });
      await expect(page.getByText(nickname + " was promoted in ETS2.")).toBeVisible();
      expect(await roles()).toEqual(["dispatcher", "driver"]);

      await page.goto("/account/admin/settings?tab=qualifications");
      await settings.getByRole("button", { name: "Archive " + name, exact: true }).click();
      await expect(settings.getByLabel("Transfer drivers to")).toHaveValue(source.id);
      await settings.getByRole("button", { name: "Review archive", exact: true }).click();
      const archived = page.waitForResponse(
        responseAt(ladderPath + "/levels/" + changed.nextLevel.id + "/archive", "POST"),
      );
      const archivedSummary = page.waitForResponse(responseAt(summaryPath, "GET"));
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Archive level", exact: true })
        .click();
      expect((await archived).status()).toBe(200);
      const afterArchive = (
        (await (await archivedSummary).json()).data as S["WorkspaceStage3Summary"]
      ).promotionsReady;
      if (!afterArchive) throw new Error("PROMOTIONS_READY_MISSING");
      await expect(attention(afterArchive.ets2 + afterArchive.ats)).toBeVisible();
      await expect(table.getByRole("rowheader", { name: new RegExp(name) })).toHaveCount(0);
      expect(afterArchive).toEqual(published);
      expect(await roles()).toEqual(["dispatcher", "driver"]);
      const atsEnd = await qualifications.progress(fixture.staff, userId, "ats", "admin");
      expect(atsEnd.version).toBe(atsStart.version);
      expect(atsEnd.data.assignment).toEqual(atsStart.data.assignment);
      await page.goto(promotionsPage + "?game=ets2&tab=history&memberId=" + userId);
      const history = page.getByRole("table", { name: "Company qualification history" });
      const transfer = history.getByRole("row").filter({ hasText: "Transfer from archived level" });
      await expect(transfer).toContainText(nickname);
      await expect(transfer).toContainText(source.name);
      await expect(history.getByRole("row").filter({ hasText: promotionReason })).toContainText(
        name,
      );
      await switchLanguage(page, "ru");
      const russianHistory = page.getByRole("table", { name: "История квалификаций в компании" });
      await expect(
        russianHistory.getByRole("row").filter({ hasText: "Перевод с архивного уровня" }),
      ).toContainText(nickname);
      await expect(
        russianHistory.getByText("ladder_archive_transfer", { exact: true }),
      ).toHaveCount(0);
      succeeded = true;
    } finally {
      try {
        if (qualifications && originalFirstId) {
          for (const temporaryName of [name, sourceName]) {
            const current = await qualifications.ladder(fixture.staff, "ets2");
            const temporary = current.data.levels.find((row) => row.name === temporaryName);
            if (temporary)
              await qualifications.changeLadder(
                fixture.staff,
                "ets2",
                randomUUID(),
                current.version,
                {
                  type: "archive",
                  levelId: temporary.id,
                  input: {
                    targetLevelId: originalFirstId,
                    observedDriverCount: temporary.currentDriverCount,
                  },
                },
              );
          }
        }
        for (const id of [userId, atsOnlyId]) {
          if (!id) continue;
          const member = await fixture.unit.run(async (tx) =>
            (await identity.memberSummariesInTransaction(tx, [id])).get(id),
          );
          if (!member || member.formerMember) continue;
          const actor = await fixtureActor(identity, id + "@example.invalid", fixture.password);
          const current = await identity.current(actor);
          await identity.administer(fixture.staff, id, randomUUID(), current.version, {
            kind: "deactivate",
          });
        }
      } catch {
        if (succeeded) throw new Error("PROMOTION_BROWSER_FIXTURE_CLEANUP_FAILED");
        console.error("PROMOTION_BROWSER_FIXTURE_CLEANUP_FAILED");
      } finally {
        await staff?.dispose();
        await fixture.close();
      }
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
