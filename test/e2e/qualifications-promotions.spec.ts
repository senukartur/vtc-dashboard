import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { envelope } from "./support/catalogs.ts";
import { mockDashboardRoutes } from "./support/dashboard-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { openMoreSheet, phone } from "./support/locale.ts";
import { inertNotifications } from "./support/notifications.ts";

type S = components["schemas"];
type Candidate = S["QualificationStage3PromotionCandidate"];
type History = S["QualificationStage3CompanyAction"];
const path = "/account/admin/promotions";
const candidatePath = "/api/v1/admin/promotion-candidates";
const historyPath = "/api/v1/admin/promotion-history";
const searchPath = "/api/v1/admin/qualification-members";
const summaryPath = "/api/v1/me/workspace-summary";
const instant = "2026-10-18T23:15:00.000Z";
const historyInstant = "2026-10-19T09:15:00.000Z";
const id = (n: number) => `ed100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const main: S["MemberSummary"] = {
  id: id(1),
  nickname: "Fictional Northstar",
  formerMember: false,
  roles: ["trainee"],
};
const second: S["MemberSummary"] = { ...main, id: id(2), nickname: "Fictional Tundra" };
const ats: S["MemberSummary"] = {
  ...main,
  id: id(3),
  nickname: "Fictional Timberline",
};
const firstLevel = { id: id(20), name: "Fictional Apprentice" };
const nextLevel = { id: id(21), name: "Fictional Highway Driver" };
const changedLevel = { id: id(22), name: "Fictional Long Haul" };
const first: Candidate = {
  member: main,
  game: "ets2",
  assignmentId: id(10),
  version: 7,
  currentLevel: firstLevel,
  nextLevel,
  acceptedTrips: 3,
  actualDistanceM: "1250.000000000000000001",
  requiredTrips: 2,
  requiredDistanceM: "1000",
  eligible: true,
  eligibleSince: instant,
};
const terminal: Candidate = {
  ...first,
  member: second,
  assignmentId: id(11),
  currentLevel: changedLevel,
  nextLevel: null,
  requiredTrips: null,
  requiredDistanceM: null,
  eligible: false,
  eligibleSince: null,
};
const atsCandidate: Candidate = {
  ...first,
  member: ats,
  game: "ats",
  assignmentId: id(12),
  eligibleSince: null,
};
const qualificationAssignment: History = {
  id: id(30),
  assignmentId: terminal.assignmentId,
  kind: "assignment",
  purpose: "initial",
  assignedAt: instant,
  endedAt: null,
  actor: null,
  reason: null,
  member: second,
  game: "ets2",
  level: firstLevel,
};
const recordedPromotion: History = {
  id: id(31),
  kind: "promotion",
  sourceAssignmentId: id(14),
  targetAssignmentId: id(15),
  sourceLevel: firstLevel,
  targetLevel: nextLevel,
  member: main,
  actor: { id: fixtureId, nickname: "Fictional Staff" },
  game: "ets2",
  confirmedAt: historyInstant,
  reason: "Synthetic history reason",
  acceptedTrips: first.acceptedTrips,
  actualDistanceM: first.actualDistanceM,
  requiredTrips: first.requiredTrips,
  requiredDistanceM: first.requiredDistanceM,
};

function defer() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function mockPromotions(
  page: Page,
  {
    role = "director",
    locale = "en",
    selfPromotion = false,
  }: { role?: Role; locale?: "ru" | "en"; selfPromotion?: boolean } = {},
) {
  const self = accountFixture(locale);
  self.data.member.roles = [role];
  self.data.capabilities = capabilities([role]);
  self.data.preferences.displayTimezone = "Asia/Tokyo";
  const state = {
    reads: [] as URL[],
    commands: [] as {
      path: string;
      body: S["PromotionInput"];
      key: string | undefined;
      version: string | undefined;
      csrf: string | undefined;
    }[],
    current: selfPromotion ? { ...first, member: self.data.member } : { ...first },
    other: null as Candidate | null,
    committed: false,
    fail: null as "conflict" | "uncertain" | "invalidReceipt" | null,
    gate: null as Promise<void> | null,
    forbidden: false,
    selfReads: 0,
    candidateReadsAfterSelfRefresh: 0,
    summaryReadsAfterSelfRefresh: 0,
    selfRefreshed: false,
    summary: null as ((committed: boolean) => S["WorkspaceStage3Summary"]) | null,
  };
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const req = route.request();
    const url = new URL(req.url());
    const game = url.searchParams.get("game");
    const cursor = url.searchParams.get("cursor");
    if (url.pathname === "/api/v1/me") {
      state.selfReads++;
      state.selfRefreshed = selfPromotion && self.data.capabilities.includes("trips.submit_own");
      return route.fulfill({ json: self });
    }
    if (url.pathname === "/api/v1/auth/csrf")
      return route.fulfill({ json: envelope({ token: "synthetic-csrf" }) });
    if (url.pathname === summaryPath) {
      state.reads.push(url);
      if (state.selfRefreshed) state.summaryReadsAfterSelfRefresh++;
      return route.fulfill({
        json: envelope(state.summary?.(state.committed) ?? { computedAt: instant }),
      });
    }
    if (url.pathname === candidatePath) {
      state.reads.push(url);
      if (state.selfRefreshed) state.candidateReadsAfterSelfRefresh++;
      if (state.forbidden) return route.fulfill({ status: 403, json: {} });
      if (cursor === "expired")
        return route.fulfill({
          status: 409,
          json: {
            ...envelope(undefined),
            error: { code: "VERSION_CONFLICT", messageKey: "version_conflict", retryable: false },
          },
        });
      const all = url.searchParams.get("status") === "all";
      const promoted = {
        ...terminal,
        member: state.current.member,
        assignmentId: id(13),
        currentLevel: state.current.nextLevel ?? nextLevel,
      };
      const rows =
        game === "ats"
          ? [atsCandidate]
          : all
            ? [state.committed ? promoted : state.current, state.other ?? terminal]
            : state.committed
              ? []
              : [state.current, ...(state.other ? [state.other] : [])];
      return route.fulfill({
        json: envelope({
          items: cursor ? rows.slice(1) : rows.slice(0, 1),
          nextCursor: !cursor && rows.length > 1 ? "second-candidate-page" : null,
          total: rows.length,
        }),
      });
    }
    if (url.pathname === historyPath) {
      state.reads.push(url);
      const memberId = url.searchParams.get("memberId");
      const action = state.committed
        ? { ...recordedPromotion, reason: "Verified progress" }
        : recordedPromotion;
      const rows = [action, qualificationAssignment].filter(
        (item) => item.game === game && (!memberId || item.member.id === memberId),
      );
      return route.fulfill({
        json: envelope({
          items: cursor ? rows.slice(1) : rows.slice(0, 1),
          nextCursor: !cursor && rows.length > 1 ? "second-history-page" : null,
          total: rows.length,
        }),
      });
    }
    if (url.pathname === searchPath) {
      state.reads.push(url);
      const term = url.searchParams.get("search")?.toLowerCase() ?? "";
      const rows = [state.current.member, state.other?.member ?? second, ats].filter((item) =>
        item.nickname.toLowerCase().includes(term),
      );
      return route.fulfill({
        json: envelope({
          items: cursor ? rows.slice(1) : rows.slice(0, 1),
          nextCursor: !cursor && rows.length > 1 ? "second-search-page" : null,
        }),
      });
    }
    if (
      /^\/api\/v1\/admin\/members\/[^/]+\/promotions$/.test(url.pathname) &&
      req.method() === "POST"
    ) {
      const memberId = url.pathname.split("/").at(-2);
      const chosen = [state.current, state.other].find((item) => item?.member.id === memberId);
      if (!chosen) return route.fulfill({ status: 404, json: {} });
      const headers = req.headers();
      state.commands.push({
        path: url.pathname,
        body: req.postDataJSON(),
        key: headers["idempotency-key"],
        version: headers["if-match"],
        csrf: headers["x-csrf-token"],
      });
      await state.gate;
      const failure = state.fail;
      state.fail = null;
      if (failure === "conflict") {
        state.current = {
          ...chosen,
          version: chosen.version + 1,
          nextLevel: changedLevel,
        };
        if (state.other?.member.id === chosen.member.id) state.other = null;
        return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
      }
      state.committed = true;
      if (selfPromotion) {
        self.data.member.roles = [role, "driver"];
        self.data.capabilities = capabilities([role, "driver"]);
      }
      if (failure === "uncertain") return route.abort("failed");
      const body: S["Assignment"] = {
        id: id(13),
        periodId: id(13),
        game: chosen.game,
        assignedAt: historyInstant,
        levelId:
          failure === "invalidReceipt" ? firstLevel.id : (chosen.nextLevel?.id ?? nextLevel.id),
      };
      return route.fulfill({ headers: { ETag: '"v9"' }, json: envelope(body) });
    }
    return route.fallback();
  });
  return state;
}

const candidates = (page: Page) => page.getByRole("table", { name: "Promotion candidates" });
const history = (page: Page) => page.getByRole("table", { name: "Company qualification history" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Promotion views" });
const confirmDialog = (page: Page) => page.getByRole("dialog", { name: "Confirm promotion" });
const heading = (page: Page) => page.getByRole("heading", { name: "Promotions", level: 1 });

test(
  "Ready and All use per-game totals and cursors",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    await page.goto(`${path}?game=all&tab=unsupported&memberId=invalid`);
    await expect(heading(page)).toBeVisible();
    await expect(candidates(page).getByRole("rowheader")).toContainText(main.nickname);
    await expect(page.getByText("1 candidate", { exact: true })).toBeVisible();
    await expect(candidates(page)).toContainText("19 Oct 2026, 08:15");
    await expect(candidates(page)).toContainText("1.250000000000000000001 km / 1 km");
    expect(state.reads.find((url) => url.pathname === candidatePath)?.searchParams.toString()).toBe(
      "game=ets2&status=eligible&limit=25",
    );
    expect(
      state.reads.filter((url) => url.pathname === historyPath || url.pathname === searchPath),
    ).toHaveLength(0);

    await tabs(page).getByRole("link", { name: "All", exact: true }).click();
    await expect(page.getByText("2 candidates", { exact: true })).toBeVisible();
    const next = page
      .getByRole("navigation", { name: "Promotion candidate pages" })
      .getByRole("button", { name: "Next page" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(candidates(page).getByRole("rowheader")).toContainText(second.nickname);
    await expect(next).toBeFocused();
    await expect(next).toBeDisabled();
    await expect(candidates(page)).toContainText("No next level");
    await expect(candidates(page)).toContainText("3 / No minimum");
    await expect(candidates(page).getByRole("button", { name: /Promote/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(candidates(page).getByRole("rowheader")).toContainText(main.nickname);

    await page.getByRole("combobox", { name: "Game" }).selectOption("ats");
    await expect(candidates(page).getByRole("rowheader")).toContainText(ats.nickname);
    await expect(candidates(page)).toContainText("Unknown");
    expect(
      state.reads
        .filter((url) => url.pathname === candidatePath)
        .at(-1)
        ?.searchParams.toString(),
    ).toBe("game=ats&status=all&limit=25");
  },
);

test(
  "History shows both action types and filters by server-searched member",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page, { role: "deputy_director" });
    await page.goto(`${path}?tab=history&memberId=invalid`);
    await expect(history(page)).toContainText("Fictional Apprentice → Fictional Highway Driver");
    await expect(history(page)).toContainText("Fictional Staff");
    await expect(history(page)).toContainText("Synthetic history reason");
    await expect(history(page).locator("time")).toHaveAttribute("datetime", historyInstant);
    await expect(page.getByText("2 actions", { exact: true })).toBeVisible();
    const historyPager = page.getByRole("navigation", { name: "Qualification history pages" });
    await historyPager.getByRole("button", { name: "Next page" }).click();
    await expect(history(page)).toContainText("Initial assignment");
    await expect(history(page).getByText("Not recorded")).toHaveCount(2);
    await expect(history(page).locator("time")).toHaveAttribute("datetime", instant);
    const search = page.getByRole("searchbox", { name: "Search by nickname" });
    await search.fill("Fictional");
    const searchPager = page.getByRole("navigation", { name: "Driver search result pages" });
    await expect(historyPager).toBeVisible();
    await expect(searchPager).toBeVisible();
    await searchPager.getByRole("button", { name: "Next page" }).click();
    await expect(
      page
        .getByRole("combobox", { name: "Select a driver" })
        .locator("option")
        .filter({ hasText: second.nickname }),
    ).toHaveCount(1);
    await expect(history(page)).toContainText("Initial assignment");

    await search.fill("  tunDra  ");
    await expect(searchPager).toHaveCount(0);
    await page.getByRole("combobox", { name: "Select a driver" }).selectOption(second.id);
    await expect(history(page).getByRole("rowheader")).toContainText(second.nickname);
    await expect(page.getByText("1 action", { exact: true })).toBeVisible();
    const searchRequests = state.reads.filter((url) => url.pathname === searchPath);
    expect(searchRequests.at(-1)?.searchParams.toString()).toBe(
      "view=stage3&search=tunDra&limit=25",
    );
    const request = state.reads.filter((url) => url.pathname === historyPath).at(-1);
    expect(request?.searchParams.get("memberId")).toBe(second.id);
    expect(request?.searchParams.get("cursor")).toBeNull();
    expect(state.reads.filter((url) => url.pathname === candidatePath)).toHaveLength(0);
    await page.getByRole("button", { name: "All drivers", exact: true }).click();
    await expect(history(page).getByRole("rowheader")).toContainText(main.nickname);
  },
);

test(
  "Confirm requires a reason, holds one versioned write, then refreshes candidates, history and summary",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    const gate = defer();
    state.gate = gate.promise;
    await page.goto(path);
    await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    const reason = dialog.getByRole("textbox", { name: "Reason" });
    const confirm = dialog.getByRole("button", { name: "Confirm promotion" });
    await expect(reason).toBeFocused();
    await expect(dialog).toContainText("Fictional Apprentice → Fictional Highway Driver");
    await reason.fill("   ");
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a reason for the promotion.");
    expect(state.commands).toHaveLength(0);
    await reason.fill("  Verified progress  ");
    const summaryReads = state.reads.filter((url) => url.pathname === summaryPath).length;
    try {
      await confirm.click();
      await expect(dialog.getByRole("button", { name: "Confirming…" })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect.poll(() => state.commands.length).toBe(1);
      expect(state.commands[0]).toEqual({
        path: `/api/v1/admin/members/${main.id}/promotions`,
        body: {
          game: "ets2",
          assignmentId: first.assignmentId,
          targetLevelId: nextLevel.id,
          reason: "Verified progress",
        },
        key: expect.stringMatching(/^[0-9a-f-]{36}$/),
        version: '"v7"',
        csrf: "synthetic-csrf",
      });
    } finally {
      gate.release();
    }
    await expect(dialog).toHaveCount(0);
    await expect(heading(page)).toBeFocused();
    await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
    await expect(page.getByText("No drivers are ready for promotion in this game.")).toBeVisible();
    expect(state.reads.filter((url) => url.pathname === summaryPath).length).toBeGreaterThan(
      summaryReads,
    );
    await tabs(page).getByRole("link", { name: "History" }).click();
    await expect(history(page)).toContainText("Verified progress");
    const readyTab = tabs(page).getByRole("link", { name: "Ready" });
    await readyTab.click();
    await expect(readyTab).toHaveAttribute("aria-current", "page");
    await page.getByRole("combobox", { name: "Game" }).selectOption("ats");
    await expect(candidates(page).getByRole("rowheader")).toContainText(ats.nickname);
  },
);

test(
  "A changed ladder requires a fresh preview and new command",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    state.fail = "conflict";
    await page.goto(path);
    const promote = page.getByRole("button", { name: `Promote ${main.nickname}` });
    await promote.click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Review before confirmation");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(dialog.getByRole("alert")).toContainText("eligibility or next level changed");
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(candidates(page)).toContainText(changedLevel.name);
    expect(state.commands).toHaveLength(1);
    await promote.click();
    await expect(dialog).toContainText(changedLevel.name);
    await expect(dialog.getByRole("textbox", { name: "Reason" })).toHaveValue(
      "Review before confirmation",
    );
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands[1]).toMatchObject({
      version: '"v8"',
      body: { targetLevelId: changedLevel.id },
    });
    expect(state.commands[1]?.key).not.toBe(state.commands[0]?.key);
  },
);

test(
  "A stale confirmation on page two exposes conflict and requires a fresh confirmation",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    state.other = { ...first, member: second, assignmentId: id(17), version: 12 };
    state.fail = "conflict";
    await page.goto(path);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/cursor=second-candidate-page$/);

    const promote = page.getByRole("button", { name: `Promote ${second.nickname}` });
    const dialog = confirmDialog(page);
    const confirm = dialog.getByRole("button", { name: "Confirm promotion" });
    const reason = dialog.getByRole("textbox", { name: "Reason" });
    await promote.click();
    await reason.fill("Review changed qualification");
    await confirm.click();
    await expect(page).toHaveURL(/game=ets2&tab=ready$/);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("eligibility or next level changed");
    const review = page.getByRole("button", { name: "Review updated candidates" });
    await expect(review).toBeFocused();
    await expect(promote).toBeDisabled();

    await review.click();
    await expect(heading(page)).toBeFocused();
    await expect(promote).toBeEnabled();
    expect(state.commands).toHaveLength(1);
    await promote.click();
    await expect(dialog).toContainText(changedLevel.name);
    await expect(reason).toHaveValue("Review changed qualification");
    expect(state.commands).toHaveLength(1);
    await confirm.click();
    await expect(page.getByText(`${second.nickname} was promoted in ETS2.`)).toBeVisible();
    expect(state.commands).toHaveLength(2);
    expect(state.commands[0]).toMatchObject({
      path: `/api/v1/admin/members/${second.id}/promotions`,
      version: '"v12"',
      body: { targetLevelId: nextLevel.id },
    });
    expect(state.commands[1]).toMatchObject({
      path: `/api/v1/admin/members/${second.id}/promotions`,
      version: '"v13"',
      body: {
        game: "ets2",
        assignmentId: id(17),
        targetLevelId: changedLevel.id,
        reason: "Review changed qualification",
      },
    });
    expect(state.commands[1]?.key).not.toBe(state.commands[0]?.key);
  },
);

for (const failure of ["uncertain", "invalidReceipt"] as const)
  test(
    `${failure} receipt keeps the exact command and original precondition`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockPromotions(page);
      state.fail = failure;
      await page.goto(path);
      await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
      const dialog = confirmDialog(page);
      await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
      await dialog.getByRole("button", { name: "Confirm promotion" }).click();
      await expect(dialog.getByRole("alert")).toContainText("The result could not be confirmed.");
      await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toHaveCount(0);
      await dialog.getByRole("button", { name: "Close preview" }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "Retry original confirmation" }).click();
      await dialog.getByRole("button", { name: "Retry original confirmation" }).click();
      await expect(dialog).toHaveCount(0);
      expect(state.commands).toEqual([state.commands[0], state.commands[0]]);
      await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
    },
  );

test(
  "A lost receipt is recoverable after navigating Back and Forward",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    const gate = defer();
    state.fail = "uncertain";
    state.gate = gate.promise;
    await page.goto("/account/dashboard");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Promotions", exact: true })
      .click();
    await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    try {
      await expect.poll(() => state.commands.length).toBe(1);
      await page.goBack();
      await expect(page).toHaveURL(/\/account\/dashboard$/);
      await expect(dialog).toHaveCount(0);
      await page.goForward();
      await expect(heading(page)).toBeVisible();
      await expect(page.getByText("Confirming…", { exact: true })).toBeVisible();
    } finally {
      gate.release();
    }
    await page.getByRole("button", { name: "Retry original confirmation" }).click();
    await expect(dialog.getByRole("textbox", { name: "Reason" })).toHaveValue("Verified progress");
    await dialog.getByRole("button", { name: "Retry original confirmation" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands).toEqual([state.commands[0], state.commands[0]]);
    await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
  },
);

test(
  "A delayed receipt resets only the affected current cursor",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    const gate = defer();
    state.gate = gate.promise;
    await page.goto(path);
    await expect(candidates(page)).toBeVisible();
    await tabs(page).getByRole("link", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    try {
      await expect.poll(() => state.commands.length).toBe(1);
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      await tabs(page).getByRole("link", { name: "History", exact: true }).click();
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page).toHaveURL(/tab=history&cursor=second-history-page$/);
      await expect(history(page)).toContainText("Initial assignment");
    } finally {
      gate.release();
    }
    await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
    await expect(page).toHaveURL(/game=ets2&tab=history$/);
    await expect(history(page)).toContainText("Verified progress");
  },
);

test(
  "An ETS2 receipt leaves the currently selected ATS History view alone",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    const gate = defer();
    state.gate = gate.promise;
    await page.goto(path);
    await expect(candidates(page)).toBeVisible();
    await tabs(page).getByRole("link", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    try {
      await expect.poll(() => state.commands.length).toBe(1);
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("combobox", { name: "Game" }).selectOption("ats");
      await tabs(page).getByRole("link", { name: "History", exact: true }).click();
      await expect(page).toHaveURL(/game=ats&tab=history$/);
    } finally {
      gate.release();
    }
    await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
    await expect(page).toHaveURL(/game=ats&tab=history$/);
    await expect(page.getByText("No qualification actions match these filters.")).toBeVisible();
  },
);

test(
  "Deputy self-promotion retains confirmation success after new driving capabilities",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page, { role: "deputy_director", selfPromotion: true });
    const nickname = state.current.member.nickname;
    await page.goto(path);
    const newReport = page.getByRole("link", { name: "New report", exact: true });
    await expect(newReport).toHaveCount(0);
    await page.getByRole("button", { name: `Promote ${nickname}` }).click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(heading(page)).toBeFocused();
    await expect(page.getByText(`${nickname} was promoted in ETS2.`)).toBeVisible();
    await expect(page.getByText("No drivers are ready for promotion in this game.")).toBeVisible();
    await expect(newReport).toBeVisible();
    expect(state.candidateReadsAfterSelfRefresh).toBeGreaterThan(0);
    expect(state.summaryReadsAfterSelfRefresh).toBeGreaterThan(0);
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]?.path).toBe(`/api/v1/admin/members/${fixtureId}/promotions`);
  },
);

test(
  "A duplicate nickname stays distinguishable across candidate pages and in confirmation",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    const duplicate = {
      ...first,
      member: { ...second, nickname: main.nickname },
      assignmentId: id(17),
      version: 12,
    };
    state.other = duplicate;
    await page.goto(path);
    await expect(candidates(page).getByRole("rowheader")).toContainText(main.id.slice(-12));
    await page.getByRole("button", { name: "Next page" }).click();
    const secondRow = candidates(page)
      .getByRole("row")
      .filter({ hasText: duplicate.member.id.slice(-12) });
    await expect(secondRow.getByRole("rowheader")).toContainText(main.nickname);
    await secondRow.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    await expect(dialog.getByText(duplicate.member.id, { exact: true })).toBeVisible();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]).toMatchObject({
      path: `/api/v1/admin/members/${duplicate.member.id}/promotions`,
      body: { assignmentId: duplicate.assignmentId },
      version: '"v12"',
    });
  },
);

test(
  "One Stage 3 summary feeds the badge and Overview, then refreshes after promotion",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDashboardRoutes(page);
    const state = await mockPromotions(page);
    state.summary = (committed) => ({
      computedAt: instant,
      promotionsReady: { ets2: committed ? 0 : 1, ats: 2 },
      legacyReviewQueue: { count: 3, oldestAgeSeconds: 0 },
    });
    await page.goto("/account/dashboard");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    const actions = page.getByRole("region", { name: "Needs attention" });
    const stagedReads = () => state.reads.filter((url) => url.pathname === summaryPath);
    await expect(navigation.getByRole("link", { name: "Promotions (ready: 3)" })).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "Dispatch (3 awaiting decision)" }),
    ).toBeVisible();
    const overviewPromotion = actions.getByRole("link", { name: "Ready for promotion (3)" });
    await expect(overviewPromotion).toHaveAttribute("href", path);
    await expect(actions.getByRole("link", { name: "Awaiting decision (3)" })).toBeVisible();
    expect(stagedReads()).toHaveLength(1);

    await overviewPromotion.click();
    await page.getByRole("button", { name: `Promote ${main.nickname}` }).click();
    const dialog = confirmDialog(page);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Verified progress");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(navigation.getByRole("link", { name: "Promotions (ready: 2)" })).toBeVisible();
    await expect(page.getByText(`${main.nickname} was promoted in ETS2.`)).toBeVisible();
    await navigation.getByRole("link", { name: "Overview", exact: true }).click();
    const atsAction = actions.getByRole("link", { name: "Ready for promotion (2)" });
    await expect(atsAction).toHaveAttribute("href", `${path}?game=ats`);
    await expect(actions.getByRole("link", { name: "Awaiting decision (3)" })).toBeVisible();
    expect(stagedReads()).toHaveLength(2);
    expect(stagedReads().map((url) => url.searchParams.get("view"))).toEqual(["stage3", "stage3"]);
    await atsAction.click();
    await expect(page.getByRole("combobox", { name: "Game" })).toHaveValue("ats");
    await expect(candidates(page).getByRole("rowheader")).toContainText(ats.nickname);
  },
);

test(
  "A summary readiness field cannot give a dispatcher a promotion action",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDashboardRoutes(page);
    const state = await mockPromotions(page, { role: "dispatcher" });
    state.summary = () => ({
      computedAt: instant,
      promotionsReady: { ets2: 1, ats: 1 },
      legacyReviewQueue: { count: 3, oldestAgeSeconds: 0 },
    });
    await page.goto("/account/dashboard");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    const actions = page.getByRole("region", { name: "Needs attention" });
    await expect(actions.getByRole("link", { name: "Awaiting decision (3)" })).toBeVisible();
    await expect(actions.getByRole("link", { name: /Ready for promotion/ })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: /^Promotions/ })).toHaveCount(0);
    expect(state.reads.some((url) => url.pathname === candidatePath)).toBe(false);
  },
);

test(
  "An expired cursor returns to the first page",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockPromotions(page);
    await page.goto(`${path}?game=ets2&tab=ready&cursor=expired`);
    await expect(page.getByRole("alert")).toContainText("This page has expired");
    await page.getByRole("button", { name: "First page" }).click();
    await expect(candidates(page).getByRole("rowheader")).toContainText(main.nickname);
    expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
  },
);

test(
  "A dispatcher cannot open the workspace or request its private data",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page, { role: "dispatcher" });
    await page.goto(`${path}?tab=history&memberId=${main.id}`);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText("You don’t have access to company promotions.")).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    const navigation = phone(page)
      ? await openMoreSheet(page)
      : page.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation.getByRole("link", { name: "Promotions" })).toHaveCount(0);
    expect(state.reads.filter((url) => url.pathname !== summaryPath)).toHaveLength(0);
    expect(state.commands).toHaveLength(0);
  },
);

test(
  "A revoked read shows a localized access error and reloads authority",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockPromotions(page);
    state.forbidden = true;
    await page.goto(path);
    await expect(page.getByRole("alert")).toHaveText(
      "You don’t have access to company promotions.",
    );
    await expect(candidates(page)).toHaveCount(0);
    await expect.poll(() => state.selfReads).toBeGreaterThan(1);
  },
);

const labels = {
  en: {
    title: "Promotions",
    tabs: "Promotion views",
    table: "Promotion candidates",
    columns: [
      "Driver",
      "Game",
      "Transition",
      "Accepted trips",
      "Accepted distance",
      "Ready since",
      "Action",
    ],
    button: `Promote ${main.nickname}`,
    confirm: "Confirm promotion",
    reason: "Reason",
  },
  ru: {
    title: "Повышения",
    tabs: "Разделы повышений",
    table: "Кандидаты на повышение",
    columns: [
      "Водитель",
      "Игра",
      "Переход",
      "Принятые рейсы",
      "Принятый пробег",
      "Дата готовности",
      "Действие",
    ],
    button: `Повысить ${main.nickname}`,
    confirm: "Подтвердить повышение",
    reason: "Причина",
  },
};

for (const locale of ["en", "ru"] as const)
  test(
    `${locale} P10 table and confirmation fit the workspace viewport and keyboard`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const ui = labels[locale];
      await mockPromotions(page, { locale });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: ui.title })).toBeVisible();
      const table = page.getByRole("table", { name: ui.table });
      await expect(table.getByRole("columnheader")).toHaveText(ui.columns);
      await expect(table.getByRole("rowheader")).toContainText(main.nickname);
      await expect(
        page.getByRole("navigation", { name: ui.tabs }).locator('a[aria-current="page"]'),
      ).toHaveCount(1);
      const width = page.viewportSize()?.width ?? 0;
      if (width <= 800) await expect(table.locator(".data-table-label").first()).toBeVisible();
      else await expect(table.locator(".data-table-label").first()).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("promotions.png"), fullPage: true });
      const button = table.getByRole("button", { name: ui.button });
      await button.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: ui.confirm });
      await expect(dialog.getByRole("textbox", { name: ui.reason })).toBeFocused();
      await page.screenshot({ path: info.outputPath("confirmation.png"), fullPage: true });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
    },
  );
