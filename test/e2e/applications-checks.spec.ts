import type { Locator, Page } from "@playwright/test";
import {
  attemptAt,
  badgeApplicants,
  badgeChecks,
  box,
  brokenWords,
  type Check,
  canonicalApplicant,
  checkedAt,
  checks,
  envelope,
  mockRechecks,
  noOverflow,
  player,
  validEnvelope,
} from "./support/application-checks.ts";
import { ids, mockApplications, names } from "./support/applications.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

// VTC-149: the TruckersMP check and referral source in the staff application detail; VTC-161: the
// check badges in the queue list. Fictional applicant, player and VTC only; every stubbed shape is
// the Stage 4 shape the API returns.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const anyUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const detailPath = `/admin/applications/${ids.submitted}`;
const master = (page: Page) => page.locator(".admin-master");
const detail = (page: Page) => page.locator(".applications-detail");
const fact = (page: Page) => page.locator(".applications-check");
const referral = (page: Page) =>
  detail(page)
    .locator(".applications-facts > div")
    .filter({
      has: page.getByText(/^(How they heard about us|Откуда узнали о нас)$/),
    });
const detailReads = (reads: string[]) => reads.filter((path) => path === detailPath).length;
/** Admissions reads only: the shell's own timed reads (for example /me/upcoming-event) are not ours. */
const admissionsReads = (reads: string[]) =>
  reads.filter((path) => ["/admin/", "/mail-deliveries"].some((prefix) => path.startsWith(prefix)));

type Setup = {
  check?: Check | null;
  locale?: "en" | "ru";
  fields?: Record<string, unknown>;
  clock?: boolean;
};
/** Opens the first submitted application; `check` gives it a /profiles/ link and that check. */
async function open(page: Page, setup: Setup = {}) {
  if (setup.clock) await page.clock.install();
  const state = await mockApplications(page);
  if (setup.check !== undefined) canonicalApplicant(state, ids.submitted, setup.check);
  const app = state.apps.find((item) => item.id === ids.submitted);
  if (app && setup.fields) Object.assign(app.fields, setup.fields);
  const rechecks = await mockRechecks(page, state);
  await page.goto("/account/admin/applications?status=submitted");
  await catalogLanguage(page, setup.locale ?? "en");
  await master(page).getByRole("button", { name: names.submitted, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: names.submitted })).toBeVisible();
  await expect(detail(page).locator(".applications-history-item").first()).toBeVisible();
  return { state, rechecks };
}
async function formatted(page: Page, value: string, locale: "en" | "ru" = "en") {
  return page.evaluate(
    ([at, tag]) =>
      new Intl.DateTimeFormat(tag, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(at ?? "")),
    [value, locale === "en" ? "en-GB" : "ru-RU"],
  );
}
const line = (page: Page) => fact(page).locator(".applications-check-state");
const button = (page: Page, name: string | RegExp) =>
  fact(page).getByRole("button", { name, exact: typeof name === "string" });

test(
  "C0 every check fixture is a valid Stage 4 detail and recheck response",
  browserCase(["@functional"]),
  async () => {
    const previous = checks.found();
    const all = [
      checks.notRequested(),
      checks.vanity(),
      previous,
      checks.found({ bans: null }),
      checks.notFound(),
      checks.checking(),
      checks.checking(previous),
      checks.failed("timeout"),
      checks.failed("invalid_response", previous),
    ];
    for (const check of all) {
      expect(validEnvelope("ApplicationStage4TruckersmpCheckEnvelope", envelope(check))).toBe(true);
      expect(
        validEnvelope(
          "EnvelopeApplication",
          envelope({
            id: ids.submitted,
            version: 1,
            status: "submitted",
            submittedAt: "2026-10-30T09:30:00.000Z",
            fields: {
              nickname: names.submitted,
              email: "fictional.birch.run@example.invalid",
              steamProfileUrl: player.steamUrl,
              games: ["ets2"],
              discord: null,
              introduction: null,
              referralSource: "other",
              referralOther: " Fictional convoy poster ",
            },
            decisionReason: null,
            invitationId: null,
            decision: null,
            truckersmpCheck: check,
          }),
        ),
      ).toBe(true);
    }
    // The queue list carries the same check on each item; history items have none.
    const item = (id: string, check: Check | null) => ({
      id,
      version: 1,
      status: "submitted",
      submittedAt: "2026-10-30T09:30:00.000Z",
      fields: {
        nickname: names.submitted,
        email: "fictional.birch.run@example.invalid",
        steamProfileUrl: player.steamUrl,
        games: ["ets2"],
        discord: null,
        introduction: null,
      },
      decisionReason: null,
      invitationId: null,
      decision: null,
      ...(check ? { truckersmpCheck: check } : {}),
    });
    expect(
      validEnvelope(
        "EnvelopeListAdminApplication",
        envelope({
          items: all.map((check) => item(ids.submitted, check)),
          nextCursor: null,
          statusCounts: { submitted: all.length, approved: 0, rejected: 0 },
        }),
      ),
    ).toBe(true);
    expect(
      validEnvelope(
        "EnvelopeListAdminApplication",
        envelope({ items: [item(ids.prior, null)], nextCursor: null }),
      ),
    ).toBe(true);
  },
);

test(
  "C1 a found player shows the linked name, bans, VTC and check time",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, { check: checks.found() });
    const date = await formatted(page, checkedAt);
    await expect(line(page)).toHaveText(
      `player found · ${player.name} · no bans · VTC: ${player.vtc} [${player.tag}] · checked ${date}`,
    );
    const link = fact(page).getByRole("link", { name: player.name, exact: true });
    await expect(link).toHaveAttribute("href", player.profileUrl);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer");
    await expect(button(page, "Check again")).toBeEnabled();
    // A settled check adds no live region.
    await expect(detail(page).getByRole("status")).toHaveCount(0);
    await expect(detail(page).getByRole("alert")).toHaveCount(0);
  },
);

test(
  "C1 bans and VTC variants keep unavailable, zero and counts distinct",
  browserCase(["@functional"]),
  async ({ page }) => {
    for (const [check, locale, text] of [
      [checks.found({ bans: { any: true, count: 3 } }), "en", "3 bans"],
      [checks.found({ bans: { any: true, count: 1 } }), "en", "1 ban"],
      [checks.found({ bans: { any: true, count: 0 } }), "en", "banned"],
      [checks.found({ bans: null }), "en", "bans hidden (TruckersMP staff account)"],
      [checks.found({ bans: null }), "ru", "баны скрыты (сотрудник TruckersMP)"],
      [
        checks.found({ vtc: { inVtc: false, id: null, name: null, tag: null } }),
        "en",
        "not in a VTC",
      ],
      [checks.found({ bans: { any: true, count: 1 } }), "ru", "1 бан"],
      [checks.found({ bans: { any: true, count: 3 } }), "ru", "3 бана"],
      [checks.found({ bans: { any: true, count: 5 } }), "ru", "5 банов"],
    ] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, { check, locale });
      await expect(line(page)).toContainText(` · ${text} · `);
    }
  },
);

test(
  "C1 not found, vanity link, never checked, running and failed checks",
  browserCase(["@functional"]),
  async ({ page }) => {
    // Player not found: a successful absence, not a failure.
    await open(page, { check: checks.notFound() });
    await expect(line(page)).toHaveText(
      `player not found · checked ${await formatted(page, checkedAt)}`,
    );
    await expect(button(page, "Check again")).toBeVisible();

    // The fixture's /id/ link: no SteamID64, so no recheck the API would refuse.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page);
    await expect(line(page)).toHaveText("not checked: the Steam link has no SteamID");
    await expect(fact(page).getByRole("button")).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, { check: null });
    await expect(line(page)).toHaveText("not checked yet");
    await expect(button(page, "Check now")).toBeEnabled();

    // Running: the only live status, no button, and the earlier result stays readable.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, { check: checks.checking(checks.found()) });
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    await expect(fact(page).locator("p.muted")).toContainText(
      `previous result: player found · ${player.name} · no bans`,
    );
    await expect(fact(page).getByRole("button")).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, { check: checks.failed("timeout", checks.notFound()) });
    await expect(line(page)).toHaveText(
      `check failed: TruckersMP timed out · attempted ${await formatted(page, attemptAt)}`,
    );
    await expect(fact(page).locator("p.muted")).toContainText("previous result: player not found");
    await expect(button(page, "Check again")).toBeEnabled();
    await expect(detail(page).getByRole("status")).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, { check: checks.failed("invalid_response") });
    await expect(line(page)).toContainText("check failed: unexpected TruckersMP response");
    await expect(fact(page).locator("p.muted")).toHaveCount(0);
  },
);

test(
  "C2 a running check polls only the detail until the result arrives",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await open(page, { check: checks.checking(), clock: true });
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    state.reads.length = 0;
    state.checks.set(ids.submitted, checks.found());
    await page.clock.fastForward(5000);
    await expect(line(page)).toContainText(`player found · ${player.name}`);
    await expect(fact(page).getByRole("status")).toHaveCount(0);
    await page.clock.fastForward(120_000);
    // Exactly one extra read: the detail. No list, history or invitation re-read.
    expect(admissionsReads(state.reads)).toEqual([detailPath]);
    await expect(button(page, "Check again")).toBeVisible();
  },
);

test(
  "C2 a newly running check restarts the poll ramp at five seconds",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await open(page, { check: checks.checking(), clock: true });
    state.reads.length = 0;
    const polls = () => admissionsReads(state.reads).length;
    await page.clock.fastForward(5000);
    await expect.poll(polls).toBe(1);
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    // The second read comes 10 seconds later and finds the result.
    state.checks.set(ids.submitted, checks.notFound());
    await page.clock.fastForward(10_000);
    await expect(line(page)).toContainText("player not found");
    expect(polls()).toBe(2);
    // A new check polls after 5 seconds again, not after the next 20-second step.
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    state.checks.set(ids.submitted, checks.found());
    await page.clock.fastForward(5000);
    await expect(line(page)).toContainText(`player found · ${player.name}`);
    expect(polls()).toBe(3);
  },
);

test(
  "C3 Check again sends a bodyless keyed POST, shows Starting… and then the later result",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, rechecks } = await open(page, { check: checks.found(), clock: true });
    let release = () => {};
    rechecks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.reads.length = 0;
    await button(page, "Check again").click();
    await expect(button(page, "Starting…")).toBeDisabled();
    release();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    // The focused button is gone; focus moves to the running state so it is announced.
    await expect(line(page)).toBeFocused();
    await expect(fact(page).locator("p.muted")).toContainText("previous result: player found");
    await expect(fact(page).getByRole("button")).toHaveCount(0);
    expect(rechecks.commands).toHaveLength(1);
    expect(rechecks.commands[0]).toMatchObject({
      method: "POST",
      path: `/admin/applications/${ids.submitted}/truckersmp-checks`,
      body: null,
      ifMatch: undefined,
      contentType: undefined,
      csrf: "NONFUNCTIONAL_FIXTURE",
    });
    expect(rechecks.commands[0]?.key).toMatch(uuid);
    // The accepted recheck re-reads nothing by itself.
    expect(admissionsReads(state.reads)).toEqual([]);
    state.checks.set(ids.submitted, checks.found({ bans: { any: true, count: 2 } }));
    await page.clock.fastForward(5000);
    await expect(line(page)).toContainText(`player found · ${player.name} · 2 bans`);
    expect(admissionsReads(state.reads)).toEqual([detailPath]);
  },
);

test(
  "C3 Check now starts the first check of a canonical link",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { rechecks } = await open(page, { check: null });
    await button(page, "Check now").click();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    await expect(fact(page).locator("p.muted")).toHaveCount(0);
    expect(rechecks.commands).toHaveLength(1);
  },
);

test(
  "C4 unavailable retries with the same key; rate limit waits with the button disabled",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { rechecks } = await open(page, { check: checks.found() });
    rechecks.outcomes.push({ status: 503 });
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("alert")).toHaveText("The check is unavailable right now.");
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    expect(rechecks.commands).toHaveLength(2);
    expect(rechecks.commands[1]?.key).toBe(rechecks.commands[0]?.key);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    const limited = await open(page, { check: checks.found() });
    limited.rechecks.outcomes.push({ status: 429, retryAfter: "30" });
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("alert")).toHaveText(/^You can retry in (30|29|28) s\.$/);
    await expect(button(page, "Check again")).toBeDisabled();
    expect(limited.rechecks.commands).toHaveLength(1);
  },
);

test(
  "C4 a forbidden recheck re-reads the session; a refused link re-reads the detail",
  browserCase(["@functional"]),
  async ({ page }) => {
    let me = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/me") me += 1;
    });
    const { rechecks } = await open(page, { check: checks.found() });
    rechecks.outcomes.push({ status: 403 });
    const before = me;
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("alert")).toHaveText("You don't have access to this check.");
    await expect(fact(page).getByRole("alert")).toBeFocused();
    await expect.poll(() => me).toBeGreaterThan(before);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    const refused = await open(page, { check: checks.found() });
    refused.rechecks.outcomes.push({ status: 409 });
    const reads = detailReads(refused.state.reads);
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("alert")).toHaveText("This Steam link can't be checked.");
    await expect.poll(() => detailReads(refused.state.reads)).toBeGreaterThan(reads);
    // The re-read remounts the row without the clicked button; focus stays on the explanation.
    await expect(fact(page).getByRole("alert")).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: names.submitted })).toBeVisible();
  },
);

test(
  "C4 an unconfirmed recheck asks to retry and replays the same key",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { rechecks } = await open(page, { check: checks.found() });
    rechecks.outcomes.push("abort");
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("alert")).toHaveText(
      "Couldn't confirm the recheck. Try again.",
    );
    await button(page, "Check again").click();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    expect(rechecks.commands[1]?.key).toBe(rechecks.commands[0]?.key);
  },
);

test(
  "C5 a failed poll keeps the check and detail, stops polling and recovers with Refresh",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await open(page, { check: checks.checking(checks.found()), clock: true });
    state.detailStatus = 503;
    state.reads.length = 0;
    await page.clock.fastForward(5000);
    await expect(
      fact(page).getByText("Couldn't update the check status.", { exact: true }),
    ).toBeVisible();
    await expect(fact(page).getByRole("status")).toHaveText("checking…");
    await expect(fact(page).locator("p.muted").first()).toContainText(
      "previous result: player found",
    );
    await expect(page.getByRole("heading", { level: 2, name: names.submitted })).toBeVisible();
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await page.clock.fastForward(120_000);
    expect(admissionsReads(state.reads)).toEqual([detailPath]);
    state.detailStatus = 200;
    state.checks.set(ids.submitted, checks.notFound());
    await button(page, "Refresh").click();
    await expect(line(page)).toContainText("player not found");
    await expect(fact(page).getByText("Couldn't update the check status.")).toHaveCount(0);
  },
);

test(
  "C6 the referral source: none, a source, other with and without text, RU and EN",
  browserCase(["@functional"]),
  async ({ page }) => {
    for (const [fields, locale, text] of [
      [{}, "en", "not specified"],
      [{ referralSource: "friend_or_member" }, "en", "From a friend or member"],
      [{ referralSource: "other" }, "en", "Other"],
      [
        { referralSource: "other", referralOther: "Fictional convoy\nposter" },
        "en",
        "Other: «Fictional convoy\nposter»",
      ],
      [{}, "ru", "не указано"],
      [{ referralSource: "youtube_or_twitch" }, "ru", "YouTube или Twitch"],
      [
        { referralSource: "other", referralOther: "Fictional convoy poster" },
        "ru",
        "Другое: «Fictional convoy poster»",
      ],
    ] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, { fields, locale });
      const value = referral(page).locator("dd");
      await expect(value).toBeVisible();
      expect(await value.evaluate((element) => (element as HTMLElement).innerText)).toBe(text);
    }
  },
);

const layoutStates = {
  found: () => checks.found({ bans: { any: true, count: 2 } }),
  checking: () => checks.checking(checks.found()),
  failed: () => checks.failed("rate_limited", checks.notFound()),
};
async function recheckTarget(page: Page, control: Locator) {
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
}
for (const locale of ["en", "ru"] as const)
  test(
    `C7 ${locale} check and referral facts fit every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      for (const [name, check] of Object.entries(layoutStates)) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await open(page, {
          check: check(),
          locale,
          fields: {
            referralSource: "other",
            referralOther:
              "Fictional convoy poster at the Kassel rest stop, shared in a long community thread",
          },
        });
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(line(page)).toBeVisible();
        await noOverflow(page);
        expect(await brokenWords(detail(page))).toEqual([]);
        const control = fact(page).getByRole("button");
        if (name !== "checking") await recheckTarget(page, control);
        else await expect(control).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: info.outputPath(`applications-check-${name}-${locale}.png`),
          fullPage: true,
        });
      }
    },
  );

// VTC-161: the queue's TruckersMP column. The group decides symbol and tone; the label names why.
const badgeText = {
  en: {
    passed: "No bans",
    attention: "Has bans",
    failed: "Check failed",
    pending: "Checking",
    legend: "What the TruckersMP badges mean",
    title: "TruckersMP check",
    meanings: [
      "No bans: player found, no bans, not in a VTC.",
      "Attention: bans found or hidden, player not found on TruckersMP, or in a VTC.",
      "Check failed: TruckersMP did not answer. Check again in the application.",
      "Checking or not checked: running, not started yet, or the Steam link has no SteamID.",
    ],
  },
  ru: {
    passed: "Банов нет",
    attention: "Есть баны",
    failed: "Ошибка проверки",
    pending: "Проверяется",
    legend: "Что означают отметки TruckersMP",
    title: "Проверка TruckersMP",
    meanings: [
      "Банов нет — игрок найден, банов нет, не состоит в ВТК.",
      "Внимание — есть или скрыты баны, игрок не найден на TruckersMP или состоит в ВТК.",
      "Ошибка проверки — TruckersMP не ответил. Повторите проверку в заявке.",
      "Проверяется или не проверено — проверка идёт, ещё не запускалась или в ссылке на Steam нет SteamID.",
    ],
  },
} as const;
const groups = ["passed", "attention", "failed", "pending"] as const;
const rows = (page: Page) => master(page).locator("tbody tr");
const badge = (row: Locator) => row.locator(".applications-check-badge");
/** Opens the submitted queue; `prepare` adjusts the mocked applications before the first read. */
async function queue(
  page: Page,
  locale: "en" | "ru",
  prepare: (state: Awaited<ReturnType<typeof mockApplications>>) => void,
) {
  const state = await mockApplications(page);
  prepare(state);
  await page.goto("/account/admin/applications?status=submitted");
  await catalogLanguage(page, locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(rows(page).first()).toBeVisible();
  return state;
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path, fullPage: true });
}

for (const locale of ["en", "ru"] as const)
  test(
    `C8 ${locale} list badges show every check state and fit every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = badgeText[locale];
      await queue(page, locale, (state) => badgeApplicants(state));
      await expect(rows(page)).toHaveCount(groups.length);
      const phone = info.project.name === "mobile-chromium";
      for (const [index, group] of groups.entries()) {
        const row = rows(page).nth(index);
        await expect(badge(row)).toHaveText(s[group]);
        await expect(badge(row)).toHaveClass(
          new RegExp(
            `badge-${{ passed: "ok", attention: "warn", failed: "error", pending: "neutral" }[group]}`,
          ),
        );
        // Text, not colour, carries the state; the symbol is decorative.
        await expect(badge(row).locator("[aria-hidden=true]")).toHaveCount(1);
        const prefix = row.locator(".applications-check-prefix");
        if (phone) {
          await expect(prefix).toBeVisible();
          const card = await box(row),
            mark = await box(badge(row));
          expect(mark.x).toBeGreaterThanOrEqual(card.x);
          expect(mark.x + mark.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
          expect(mark.y).toBeGreaterThanOrEqual(card.y);
          expect(mark.y + mark.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
        } else await expect(prefix).toBeHidden();
      }
      if (phone) expect((await box(master(page).locator("thead"))).height).toBeLessThanOrEqual(1);
      else await expect(master(page).getByRole("columnheader").nth(2)).toHaveText("TruckersMP");
      await noOverflow(page);
      expect(await brokenWords(master(page))).toEqual([]);
      // No application UUID anywhere in the list.
      expect(
        await master(page).evaluate((element) => (element as HTMLElement).innerText),
      ).not.toMatch(anyUuid);

      const trigger = master(page).getByRole("button", { name: s.legend, exact: true });
      const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
      const target = await box(trigger);
      expect(target.height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
      expect(target.width).toBeGreaterThanOrEqual(coarse ? 40 : 24);
      await capture(page, info.outputPath(`applications-list-badges-${locale}.png`));

      await trigger.focus();
      await page.keyboard.press("Enter");
      const tip = page.locator(".info-tip-content");
      await expect(tip).toBeVisible();
      await expect(tip.locator("strong")).toHaveText(s.title);
      const meanings = tip.locator("p");
      await expect(meanings).toHaveCount(s.meanings.length + 1);
      for (const [index, meaning] of s.meanings.entries())
        await expect(meanings.nth(index)).toContainText(meaning);
      await capture(page, info.outputPath(`applications-list-legend-${locale}.png`));
      await page.keyboard.press("Escape");
      await expect(tip).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // The wide desktop the owner reviews (1440 px) keeps the columns without overflow.
      if (info.project.name === "desktop-chromium") {
        await trigger.blur();
        await page.setViewportSize({ width: 1440, height: 900 });
        expect(await brokenWords(master(page))).toEqual([]);
        await capture(page, info.outputPath(`applications-list-badges-${locale}-1440.png`));
      }
    },
  );

test("C8 variants map per the owner rule", browserCase(["@functional"]), async ({ page }) => {
  const clean = badgeChecks.passed;
  for (const [check, locale, text] of [
    [clean, "en", "No bans"],
    [checks.notFound(), "en", "Not found"],
    [checks.found({ bans: { any: true, count: 0 } }), "en", "Has bans"],
    [checks.found({ bans: null }), "en", "Bans hidden"],
    [checks.found(), "en", "In a VTC"],
    [checks.failed("rate_limited", clean), "en", "Check failed"],
    [checks.checking(clean), "en", "Checking"],
    [checks.checking(checks.found({ bans: { any: true, count: 3 } })), "en", "Checking"],
    [checks.notRequested(), "en", "Not checked"],
    [null, "en", "Not checked"],
    [clean, "ru", "Банов нет"],
    [checks.notFound(), "ru", "Не найден"],
    [checks.found(), "ru", "В ВТК"],
    [checks.failed("timeout"), "ru", "Ошибка проверки"],
    [checks.vanity(), "ru", "Не проверено"],
  ] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await queue(page, locale, (state) => canonicalApplicant(state, ids.submitted, check));
    await expect(badge(rows(page).first())).toHaveText(text);
  }
});

test("C8 the detail shows no application UUID", browserCase(["@functional"]), async ({ page }) => {
  await open(page, { check: checks.found() });
  await expect(
    detail(page)
      .locator(".applications-detail-head")
      .getByText(/^Submitted /),
  ).toBeVisible();
  const text = await detail(page).evaluate((element) => (element as HTMLElement).innerText);
  expect(text).not.toContain(ids.submitted);
  expect(text).not.toMatch(anyUuid);
});
