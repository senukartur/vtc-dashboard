import { createRequire } from "node:module";
import type { components } from "@vtc/contracts";
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "../../apps/web/src/app/session-cache.ts";
import {
  refreshWorkspaceSummary,
  workspaceSummaryKey,
} from "../../apps/web/src/app/workspace-summary-cache.ts";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { AccountFailure } from "../../apps/web/src/features/account/transport.ts";
import { dashboardTranslations } from "../../apps/web/src/features/dashboard/translations.ts";
import {
  DashboardFailure,
  dashboardRead,
  schema,
} from "../../apps/web/src/features/dashboard/transport.ts";
import {
  activeDriversView,
  analyticsPath,
  BREAKDOWN_LIMIT,
  blockView,
  breakdownEmpty,
  breakdownPath,
  breakdownRows,
  type Countdown,
  countdown,
  formatPercent,
  gameSplit,
  LEADERBOARD_LIMIT,
  leaderboardPath,
  leaderboardRows,
  placeView,
  type QueryView,
  RECENT_TRIPS_LIMIT,
  recentTripRow,
  recentTripsPath,
  responsePressed,
  retainsError,
  rsvpView,
  sourceShares,
  tripsKey,
  untilAnchored,
  visibleActionSections,
} from "../../apps/web/src/features/dashboard/view-model.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";
import {
  analyticsWithoutStage4,
  type BreakdownDimension,
  leaderboardWithoutStage4,
  makeAllTimeAnalyticsFixture,
  makeAnalyticsFixture,
  makeBreakdownFixture,
  makeCompanyStatsFixture,
  makeFilteredAnalyticsFixture,
  makeLeaderboardFixture,
  makeMemberAnalyticsFixture,
  makeOptionalEventFixture,
  makeRecentTripsFixture,
  makeResponseCountsFixture,
  makeRsvpFixture,
  nextUpcomingEvent,
  overviewNow,
  recentTripItems,
  recentTrips,
  upcomingEvent,
  withActiveDrivers,
} from "../e2e/support/dashboard-fixtures.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort();
}
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
/** The countdown without its timer hint: what the chip shows. */
const shown = ({ nextChangeMs: _, ...rest }: Countdown) => rest;

it("preserves workspace conflicts with or without a valid setup-required body", async () => {
  for (const setupRequired of [true, false]) {
    const body = setupRequired
      ? JSON.stringify({
          error: { code: "SETUP_REQUIRED", messageKey: "errors.setup_required", retryable: false },
          meta: { requestId: "synthetic-dashboard-conflict" },
        })
      : "Not JSON";
    const response = new Response(body, {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    const readBody = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", async () => response);
    const request = dashboardRead(
      "/me/workspace-summary?view=stage3",
      "WorkspaceStage3SummaryEnvelope",
      new AbortController().signal,
    );
    await expect(request).rejects.toBeInstanceOf(DashboardFailure);
    await expect(request).rejects.toMatchObject({ kind: "conflict", status: 409, setupRequired });
    expect(readBody).toHaveBeenCalledTimes(1);
  }
});

it("refreshes a newer authority in the command's member and generation after commit", async () => {
  const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const { QueryObserver } = require("@tanstack/react-query");
  const client = createAppQueryClient();
  const self = accountFixture().data;
  const capturedSession = { self, generation: 4 };
  const currentSession = {
    ...capturedSession,
    self: { ...self, capabilities: [...self.capabilities, "trips.review"] },
  };
  const activeKey = workspaceSummaryKey(currentSession);
  const otherMember = workspaceSummaryKey({
    ...currentSession,
    self: {
      ...currentSession.self,
      member: { ...self.member, id: "41000000-0000-4000-8000-000000000018" },
    },
  });
  const otherGeneration = workspaceSummaryKey({
    ...currentSession,
    generation: currentSession.generation + 1,
  });
  const preCommit: components["schemas"]["WorkspaceSummary"] = {
    computedAt: overviewNow,
    reviewQueue: { count: 2, oldestAgeSeconds: 30 },
    unansweredUpcomingEvents: {
      count: 1,
      items: [
        { eventId: upcomingEvent.id, startsAt: upcomingEvent.startsAt, title: upcomingEvent.title },
      ],
    },
  };
  const committed = { ...preCommit, unansweredUpcomingEvents: { count: 0, items: [] } };
  let releaseStaleRead = () => {};
  const staleRead = new Promise<typeof preCommit>((resolve) => {
    releaseStaleRead = () => resolve(preCommit);
  });
  const signals: AbortSignal[] = [];
  let source = preCommit;
  client.setQueryData(otherMember, preCommit);
  client.setQueryData(otherGeneration, preCommit);
  const observer = new QueryObserver(client, {
    queryKey: activeKey,
    staleTime: Infinity,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return signals.length === 1 ? staleRead : Promise.resolve(source);
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(activeKey).not.toEqual(workspaceSummaryKey(capturedSession));
    expect(client.getQueryState(activeKey)?.fetchStatus).toBe("fetching");
    expect(signals[0]?.aborted).toBe(false);

    source = committed;
    await refreshWorkspaceSummary(client, capturedSession);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    // A response that ignores abort still cannot replace the committed snapshot.
    releaseStaleRead();
    await staleRead;
    expect(client.getQueryState(activeKey)).toMatchObject({ data: committed, fetchStatus: "idle" });
    for (const key of [otherMember, otherGeneration]) {
      expect(client.getQueryState(key)).toMatchObject({ data: preCommit, isInvalidated: false });
    }
  } finally {
    releaseStaleRead();
    unsubscribe();
    client.clear();
  }
});

describe("recent company trips path", () => {
  it("asks for five completion-ordered accepted company trips with optional game", () => {
    expect(RECENT_TRIPS_LIMIT).toBe(5);
    expect(recentTripsPath()).toBe("/trips?scope=company&limit=5&order=completion_desc");
    expect(recentTripsPath(undefined)).toBe("/trips?scope=company&limit=5&order=completion_desc");
    expect(recentTripsPath("ets2")).toBe(
      "/trips?scope=company&limit=5&order=completion_desc&game=ets2",
    );
    expect(recentTripsPath("ats")).toBe(
      "/trips?scope=company&limit=5&order=completion_desc&game=ats",
    );
    for (const path of [recentTripsPath(), recentTripsPath("ats")])
      expect(path).not.toMatch(/decision=|cursor=|hold=/);
  });
  it("labels the trips in the interface language when one is given", () => {
    expect(recentTripsPath(undefined, "ru")).toBe(
      "/trips?scope=company&limit=5&order=completion_desc&locale=ru",
    );
    expect(recentTripsPath("ats", "en")).toBe(
      "/trips?scope=company&limit=5&order=completion_desc&game=ats&locale=en",
    );
  });
});

describe("needs attention sections", () => {
  const all = [
    "trips.read_own_private",
    "trips.submit_own",
    "events.respond",
    "trips.review",
    "applications.manage",
    "qualifications.manage",
  ];
  const summary: components["schemas"]["WorkspaceSummary"] = {
    computedAt: "2026-11-12T12:00:00.000Z",
    tripsNeedingFixes: { count: 1, items: [] },
    unfinishedManualDrafts: { count: 0, items: [] },
    unansweredUpcomingEvents: { count: 2, items: [] },
    reviewQueue: { count: 4, oldestAgeSeconds: 30 },
    newApplicationsCount: 3,
  };
  it("lists counted sections with work, in order, for the viewer's capabilities", () => {
    expect(visibleActionSections(summary, all)).toEqual([
      { key: "fixes", count: 1 },
      { key: "events", count: 2 },
      { key: "review", count: 4 },
      { key: "applications", count: 3 },
    ]);
    expect(visibleActionSections(summary, ["trips.review"])).toEqual([{ key: "review", count: 4 }]);
  });
  it("sums promotion readiness across games for staff and hides zero or omitted counts", () => {
    const loaded = { computedAt: summary.computedAt, promotionsReady: { ets2: 2, ats: 4 } };
    expect(visibleActionSections(loaded, ["qualifications.manage"])).toEqual([
      { key: "promotions", count: 6 },
    ]);
    expect(visibleActionSections(loaded, ["trips.review"])).toEqual([]);
    expect(visibleActionSections({ ...loaded, promotionsReady: { ets2: 0, ats: 0 } }, all)).toEqual(
      [],
    );
    expect(visibleActionSections({ computedAt: summary.computedAt }, all)).toEqual([]);
  });
  it("never treats a count the summary omits as a failure: the section is simply absent", () => {
    // Applications module off: the director's summary has no application count at all.
    const { newApplicationsCount: _off, ...withoutApplications } = summary;
    expect(visibleActionSections(withoutApplications, all).map(({ key }) => key)).toEqual([
      "fixes",
      "events",
      "review",
    ]);
    expect(visibleActionSections({ computedAt: summary.computedAt }, all)).toEqual([]);
    expect(dashboardTranslations.ru.actions).not.toHaveProperty("partial");
    expect(dashboardTranslations.ru.actions).not.toHaveProperty("unavailable");
    expect(dashboardTranslations.en.actions).not.toHaveProperty("partial");
  });
});

describe("block state", () => {
  const isEmpty = (data: { items: unknown[] }) => data.items.length === 0;
  const forbidden = new AccountFailure("forbidden");
  const unavailable = new AccountFailure("unavailable");

  it("keeps data after a failed background refresh", () => {
    expect(blockView({ data: { items: [1] }, isError: true, error: unavailable }, isEmpty)).toBe(
      "ready",
    );
    expect(blockView({ data: { items: [] }, isError: true, error: forbidden }, isEmpty)).toBe(
      "empty",
    );
  });

  it("separates forbidden from other failures and empty from ready", () => {
    expect(blockView({ data: undefined, isError: true, error: forbidden }, isEmpty)).toBe(
      "forbidden",
    );
    expect(blockView({ data: undefined, isError: true, error: unavailable }, isEmpty)).toBe(
      "error",
    );
    expect(blockView({ data: undefined, isError: true, error: new Error("x") }, isEmpty)).toBe(
      "error",
    );
    expect(blockView({ data: undefined, isError: false, error: null }, isEmpty)).toBe("loading");
    expect(blockView({ data: { items: [] }, isError: false, error: null }, isEmpty)).toBe("empty");
    expect(blockView({ data: { items: [1] }, isError: false, error: null }, isEmpty)).toBe("ready");
    // No upcoming event is an answered empty state, not loading.
    expect(blockView({ data: null, isError: false, error: null }, (data) => data === null)).toBe(
      "empty",
    );
  });
});

describe("recent trip rows", () => {
  const [berlin, seattle, praha, unknown, russian] = recentTripItems;

  it("formats a complete row in EN and RU", () => {
    expect(berlin && recentTripRow(berlin, "en", "UTC")).toEqual({
      id: berlin?.id,
      game: "ets2",
      origin: "Berlin",
      destination: "Warszawa",
      driver: "AlphaDriver",
      fallback: false,
      distance: "580 km",
      countedAt: "1 Nov 2099, 14:30",
    });
    const ru = berlin && recentTripRow(berlin, "ru", "Europe/Moscow");
    expect(ru?.distance).toBe("580 км");
    expect(ru?.countedAt).toContain("17:30");
    expect(russian && recentTripRow(russian, "ru", "UTC").distance).toBe(
      formatQuantity("1250000", "km", "ru"),
    );
  });

  it("shows missing values as unavailable or unknown, never zero", () => {
    for (const [locale, missing, place] of [
      ["en", "Unavailable", "Unknown"],
      ["ru", "Недоступно", "Неизвестно"],
    ] as const) {
      const noDistance = seattle && recentTripRow(seattle, locale, "UTC");
      expect(noDistance?.distance).toBe(missing);
      const noOrigin = unknown && recentTripRow(unknown, locale, "UTC");
      expect(noOrigin?.origin).toBe(place);
      expect(noOrigin?.countedAt).toBe(missing);
      for (const trip of recentTripItems)
        expect(recentTripRow(trip, locale, "UTC").distance).not.toMatch(/^0\s/);
    }
  });

  it("flags English fallback labels", () => {
    const russian = recentTrips("ru");
    const wien = russian[2] && recentTripRow(russian[2], "ru", "UTC");
    expect(wien?.fallback).toBe(true);
    expect(wien?.destination).toBe("Wien");
    expect(wien?.origin).toBe("Прага");
    expect(russian[0] && recentTripRow(russian[0], "ru", "UTC").fallback).toBe(false);
    expect(praha && recentTripRow(praha, "en", "UTC").fallback).toBe(false);
    expect(berlin && recentTripRow(berlin, "en", "UTC").fallback).toBe(false);
  });
});

describe("retry of a block without data", () => {
  it("keeps the error only until a newer outcome", () => {
    // Pressed at the first error: kept while the refetch is pending.
    expect(retainsError(1, { data: undefined, errorUpdateCount: 1 })).toBe(true);
    // Data or a later error ends it.
    expect(retainsError(1, { data: { items: [] }, errorUpdateCount: 1 })).toBe(false);
    expect(retainsError(1, { data: undefined, errorUpdateCount: 2 })).toBe(false);
    // Another query (a new game) starts without errors.
    expect(retainsError(1, { data: undefined, errorUpdateCount: 0 })).toBe(false);
    // Without a pressed Retry nothing is kept, so once reset after success a later 403 at the
    // same error count shows forbidden instead of the retained error.
    expect(retainsError(null, { data: undefined, errorUpdateCount: 1 })).toBe(false);
    expect(
      blockView(
        { data: undefined, isError: true, error: new AccountFailure("forbidden") },
        (data: { items: unknown[] }) => data.items.length === 0,
      ),
    ).toBe("forbidden");
  });
});

describe("view until the reporting timezone is known", () => {
  const refetch = async () => undefined;

  it("returns the query once anchored and shows loading before", () => {
    const settled: QueryView<{ items: unknown[] }> = {
      data: { items: [] },
      error: null,
      isError: false,
      isPending: false,
      errorUpdateCount: 2,
      refetch,
    };
    expect(untilAnchored(settled, true)).toBe(settled);
    const waiting = untilAnchored(settled, false);
    expect(waiting).toEqual({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      errorUpdateCount: 2,
      refetch,
    });
    expect(waiting.refetch).toBe(refetch);
    expect(blockView(waiting, (data) => data.items.length === 0)).toBe("loading");
    // Cached errors of a key the page may not use are hidden too.
    const failed: QueryView<{ items: unknown[] }> = {
      ...settled,
      data: undefined,
      error: new AccountFailure("forbidden"),
      isError: true,
    };
    expect(untilAnchored(failed, false)).toMatchObject({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
    });
  });
});

describe("countdown", () => {
  const startsAt = upcomingEvent.startsAt;
  const start = Date.parse(startsAt);

  it("floors each kind at its boundaries", () => {
    expect(shown(countdown(startsAt, Date.parse(overviewNow)))).toEqual({
      kind: "days",
      days: 3,
      hours: 4,
    });
    expect(shown(countdown(startsAt, start - DAY))).toEqual({ kind: "days", days: 1, hours: 0 });
    expect(shown(countdown(startsAt, start - DAY + 1))).toEqual({
      kind: "hours",
      hours: 23,
      minutes: 59,
    });
    expect(shown(countdown(startsAt, start - HOUR))).toEqual({
      kind: "hours",
      hours: 1,
      minutes: 0,
    });
    expect(shown(countdown(startsAt, start - HOUR + 1))).toEqual({ kind: "minutes", minutes: 59 });
    expect(shown(countdown(startsAt, start - MINUTE))).toEqual({ kind: "minutes", minutes: 1 });
    expect(shown(countdown(startsAt, start - MINUTE + 1))).toEqual({ kind: "soon" });
    expect(shown(countdown(startsAt, start - 1))).toEqual({ kind: "soon" });
  });

  it("counts reaching the start as started and stops the timer", () => {
    expect(countdown(startsAt, start)).toEqual({ kind: "started", nextChangeMs: null });
    expect(countdown(startsAt, start + 1)).toEqual({ kind: "started", nextChangeMs: null });
    expect(countdown(startsAt, start + 10 * DAY)).toEqual({ kind: "started", nextChangeMs: null });
  });

  it("wakes exactly when the shown text changes", () => {
    for (const before of [
      3 * DAY + 4 * HOUR + 30 * MINUTE,
      DAY,
      DAY + 1,
      2 * HOUR + 30 * MINUTE + 20_000,
      HOUR,
      61_000,
      MINUTE,
      30_000,
      1,
    ]) {
      const now = start - before;
      const current = countdown(startsAt, now);
      const next = current.nextChangeMs;
      expect(next, String(before)).not.toBeNull();
      if (next === null) continue;
      expect(next).toBeGreaterThan(0);
      expect(shown(countdown(startsAt, now + next - 1)), String(before)).toEqual(shown(current));
      expect(shown(countdown(startsAt, now + next)), String(before)).not.toEqual(shown(current));
    }
    expect(countdown(startsAt, start - 30_000).nextChangeMs).toBe(30_000);
    expect(countdown(startsAt, start - (2 * HOUR + 20_000)).nextChangeMs).toBe(20_001);
    expect(countdown(startsAt, start - (2 * DAY + 20 * MINUTE)).nextChangeMs).toBe(20 * MINUTE + 1);
  });
});

describe("own response view", () => {
  const ready = { data: { data: makeRsvpFixture(), etag: '"v1"' }, isError: false, error: null };
  const loading = { isError: false, error: null };

  it("is read-only without events.respond and closed after the start", () => {
    expect(rsvpView({ canRespond: false, phase: "open", query: ready })).toEqual({
      state: "readOnly",
    });
    expect(rsvpView({ canRespond: false, phase: "started", query: loading })).toEqual({
      state: "readOnly",
    });
    for (const phase of ["started", "cancelled", "completed"] as const)
      expect(rsvpView({ canRespond: true, phase, query: ready })).toEqual({ state: "closed" });
  });

  it("is ready only with the server response and blocks a missing ETag", () => {
    expect(rsvpView({ canRespond: true, phase: "open", query: ready })).toEqual({
      state: "ready",
      current: makeRsvpFixture().data,
      etag: '"v1"',
      canSubmit: true,
    });
    expect(
      rsvpView({
        canRespond: true,
        phase: "open",
        query: { ...ready, data: { data: makeRsvpFixture(), etag: null } },
      }),
    ).toMatchObject({ state: "ready", etag: null, canSubmit: false });
  });

  it("separates loading, forbidden and unavailable reads", () => {
    expect(rsvpView({ canRespond: true, phase: "open", query: loading })).toEqual({
      state: "loading",
    });
    expect(
      rsvpView({
        canRespond: true,
        phase: "open",
        query: { isError: true, error: new AccountFailure("forbidden") },
      }),
    ).toEqual({ state: "forbidden" });
    for (const error of [new AccountFailure("unavailable"), new Error("x")])
      expect(
        rsvpView({ canRespond: true, phase: "open", query: { isError: true, error } }),
      ).toEqual({ state: "unavailable" });
  });

  it("presses only the confirmed response, or Can't go while the decline draft is open", () => {
    expect(responsePressed("unanswered", false)).toEqual({ going: false, cantGo: false });
    expect(responsePressed("participating", false)).toEqual({ going: true, cantGo: false });
    expect(responsePressed("declined", false)).toEqual({ going: false, cantGo: true });
    expect(responsePressed("participating", true)).toEqual({ going: false, cantGo: true });
    expect(responsePressed("unanswered", true)).toEqual({ going: false, cantGo: true });
  });
});

describe("overview block translations", () => {
  const { en, ru } = dashboardTranslations;

  it("keeps the new RU and EN keys and placeholders identical", () => {
    expect(keys(en.recentTrips)).toEqual(keys(ru.recentTrips));
    expect(keys(en.upcomingEvent)).toEqual(keys(ru.upcomingEvent));
    for (const section of ["recentTrips", "upcomingEvent"] as const)
      for (const [key, text] of Object.entries(en[section]))
        expect(placeholders(ru[section][key as keyof (typeof ru)[typeof section]]), key).toEqual(
          placeholders(text),
        );
    expect(keys(en.recentTrips)).toEqual(
      ["allTrips", "empty", "error", "forbidden", "retry", "title", "unknownPlace"].sort(),
    );
    for (const key of [
      "countdownDays",
      "countdownHours",
      "countdownMinutes",
      "countdownSoon",
      "going",
      "goingUnavailable",
      "goingButton",
      "cantGoButton",
      "cancelDecline",
      "reasonRequired",
      "responseLoading",
      "responseUnavailable",
      "retry",
      "forbidden",
      "allEvents",
    ])
      expect(keys(en.upcomingEvent)).toContain(key);
    expect(en.upcomingEvent.title).toBe("Upcoming Event");
    expect(ru.upcomingEvent.title).toBe("Ближайшее мероприятие");
  });
});

describe("overview block fixtures", () => {
  it("parse with the browser runtime schemas", () => {
    for (const locale of ["en", "ru"] as const)
      expect(
        schema("EnvelopeListTripSummary").safeParse(makeRecentTripsFixture(recentTrips(locale)))
          .success,
      ).toBe(true);
    const ids = recentTrips("en").flatMap((trip) =>
      [trip.origin, trip.destination].flatMap((label) => (label ? [label.entityId] : [])),
    );
    // Distinct places keep distinct catalog IDs, and the IDs do not depend on the locale.
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      recentTrips("ru").flatMap((trip) =>
        [trip.origin, trip.destination].flatMap((label) => (label ? [label.entityId] : [])),
      ),
    ).toEqual(ids);
    for (const trip of recentTrips("ru"))
      for (const label of [trip.origin, trip.destination])
        if (label) expect(label.requestedLocale).toBe("ru");
    expect(schema("EnvelopeListTripSummary").safeParse(makeRecentTripsFixture()).success).toBe(
      true,
    );
    expect(schema("EnvelopeListTripSummary").safeParse(makeRecentTripsFixture([])).success).toBe(
      true,
    );
    for (const event of [upcomingEvent, nextUpcomingEvent, null])
      expect(
        schema("EnvelopeOptionalEvent").safeParse(makeOptionalEventFixture(event)).success,
      ).toBe(true);
    for (const rsvp of [
      makeRsvpFixture(),
      makeRsvpFixture("participating", 2),
      makeRsvpFixture("declined", 3, "Fictional schedule clash"),
    ])
      expect(schema("EnvelopeRsvp").safeParse(rsvp).success).toBe(true);
    expect(
      schema("EnvelopeEventResponseCounts").safeParse(makeResponseCountsFixture()).success,
    ).toBe(true);
    // The reporting timezone source of the period anchors: an available and an unavailable month.
    for (const zone of ["Europe/Moscow", null])
      expect(
        schema("EnvelopeCompanyStatsPublic").safeParse(makeCompanyStatsFixture(zone)).success,
      ).toBe(true);
  });

  it("start in the far future so the real clock never passes them", () => {
    for (const event of [upcomingEvent, nextUpcomingEvent])
      expect(Date.parse(event.startsAt)).toBeGreaterThan(Date.parse("2099-01-01T00:00:00Z"));
    expect(Date.parse(nextUpcomingEvent.startsAt)).toBeGreaterThan(
      Date.parse(upcomingEvent.startsAt),
    );
  });
});

describe("overview statistics paths", () => {
  const range = { fromDate: "2026-11-01", toDateExclusive: "2026-12-01" };
  const allTime = { period: "all_time" } as const;

  it("asks for company analytics with dates or, for all time, months without dates", () => {
    expect(analyticsPath(range, { granularity: "day" })).toBe(
      "/analytics/company?fromDate=2026-11-01&toDateExclusive=2026-12-01&granularity=day",
    );
    expect(analyticsPath(range, { granularity: "month", game: "ats" })).toBe(
      "/analytics/company?fromDate=2026-11-01&toDateExclusive=2026-12-01&granularity=month&game=ats",
    );
    expect(analyticsPath(allTime, { granularity: "day" })).toBe(
      "/analytics/company?period=all_time&granularity=month",
    );
    expect(analyticsPath(allTime, { granularity: "day", game: "ets2" })).toBe(
      "/analytics/company?period=all_time&granularity=month&game=ets2",
    );
  });

  it("asks for the top ten of the leaderboard", () => {
    expect(LEADERBOARD_LIMIT).toBe(10);
    expect(leaderboardPath(range)).toBe(
      "/analytics/leaderboard?fromDate=2026-11-01&toDateExclusive=2026-12-01&limit=10",
    );
    expect(leaderboardPath(allTime, "ats")).toBe(
      "/analytics/leaderboard?period=all_time&limit=10&game=ats",
    );
  });

  it("asks for five routes or cargo and the source split without a limit", () => {
    expect(BREAKDOWN_LIMIT).toBe(5);
    expect(breakdownPath("route", range, { locale: "ru" })).toBe(
      "/analytics/company/breakdown?dimension=route&fromDate=2026-11-01&toDateExclusive=2026-12-01&locale=ru&limit=5",
    );
    expect(breakdownPath("cargo", allTime, { game: "ets2", locale: "en" })).toBe(
      "/analytics/company/breakdown?dimension=cargo&period=all_time&game=ets2&locale=en&limit=5",
    );
    expect(breakdownPath("source", allTime, { locale: "en" })).toBe(
      "/analytics/company/breakdown?dimension=source&period=all_time&locale=en",
    );
    for (const dimension of ["route", "cargo", "source"] as const)
      expect(breakdownPath(dimension, allTime, { locale: "ru" })).not.toMatch(
        /fromDate|toDateExclusive|granularity/,
      );
  });
});

describe("overview KPI and place views", () => {
  const leaderboard = (options: Parameters<typeof makeLeaderboardFixture>[0]) =>
    makeLeaderboardFixture(options).data;

  it("shows the place among ranked members, not ranked, or unavailable", () => {
    expect(placeView(undefined, false)).toEqual({ kind: "loading" });
    expect(placeView(undefined, true)).toEqual({ kind: "unavailable" });
    expect(placeView(leaderboard({ viewer: "absent" }), false)).toEqual({ kind: "unavailable" });
    expect(placeView(leaderboard({ viewer: "unranked" }), false)).toEqual({ kind: "notRanked" });
    // Data wins over a failed background refresh.
    expect(placeView(leaderboard({ viewer: "unranked" }), true)).toEqual({ kind: "notRanked" });
    expect(placeView(leaderboard({ viewer: "offPage" }), false)).toEqual({
      kind: "ranked",
      position: 14,
      ranked: 15,
      acceptedTrips: 4,
      actualDistanceM: "37400000",
    });
    const { rankedMembers: _ranked, ...withoutCount } = leaderboard({ viewer: "onPage" });
    expect(placeView(withoutCount, false)).toEqual({
      kind: "ranked",
      position: 3,
      ranked: undefined,
      acceptedTrips: 15,
      actualDistanceM: "39600000",
    });
  });

  it("keeps active drivers and members separate and unavailable when absent", () => {
    expect(activeDriversView(makeAnalyticsFixture().data)).toEqual({ drivers: 2, members: 5 });
    expect(activeDriversView(makeAllTimeAnalyticsFixture().data)).toEqual({
      drivers: 9,
      members: 5,
    });
    expect(activeDriversView(makeAnalyticsFixture(true).data)).toEqual({ drivers: 0, members: 5 });
    expect(activeDriversView(analyticsWithoutStage4(makeAnalyticsFixture()).data)).toEqual({
      drivers: null,
      members: null,
    });
  });

  it("splits the totals by game only when both games are returned", () => {
    const split = gameSplit(makeAnalyticsFixture().data);
    expect(split?.ets2).toEqual({ game: "ets2", acceptedTrips: 20, actualDistanceM: "61430000" });
    expect(split?.ats).toEqual({ game: "ats", acceptedTrips: 22, actualDistanceM: "64000000" });
    const ets2 = makeFilteredAnalyticsFixture(new URLSearchParams({ game: "ets2" })).data;
    expect(gameSplit(ets2)).toBeNull();
    expect(gameSplit(analyticsWithoutStage4(makeAnalyticsFixture()).data)).toBeNull();
  });
});

describe("leaderboard rows", () => {
  it("marks the viewer on the page and adds no extra row", () => {
    const { rows, offPage } = leaderboardRows(
      makeLeaderboardFixture({ viewer: "onPage" }).data,
      fixtureId,
    );
    expect(rows.map((row) => [row.rank, row.self])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(offPage).toBeNull();
  });

  it("returns the viewer below the top ten separately", () => {
    const { rows, offPage } = leaderboardRows(
      makeLeaderboardFixture({ viewer: "offPage" }).data,
      fixtureId,
    );
    expect(rows).toHaveLength(10);
    expect(rows.some((row) => row.self)).toBe(false);
    expect(offPage).toEqual({ position: 14, acceptedTrips: 4, actualDistanceM: "37400000" });
  });

  it("adds nothing for a viewer without a place or without Stage 4 data", () => {
    for (const viewer of ["unranked", "absent"] as const) {
      const { rows, offPage } = leaderboardRows(makeLeaderboardFixture({ viewer }).data, fixtureId);
      expect(rows.map((row) => row.rank)).toEqual([1, 2]);
      expect(offPage).toBeNull();
    }
  });

  it("uses the server position and falls back to the list order", () => {
    const data = makeLeaderboardFixture({ size: 3 }).data;
    const shifted = {
      ...data,
      items: data.items.map((item, index) => ({ ...item, position: index + 4 })),
    };
    expect(leaderboardRows(shifted, undefined).rows.map((row) => row.rank)).toEqual([4, 5, 6]);
    const unnumbered = leaderboardWithoutStage4(makeLeaderboardFixture({ size: 3 })).data;
    expect(leaderboardRows(unnumbered, undefined).rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});

describe("trip breakdown views", () => {
  const breakdown = (dimension: BreakdownDimension, extra: Record<string, string> = {}) =>
    makeBreakdownFixture(
      new URLSearchParams({
        dimension,
        fromDate: "2026-10-01",
        toDateExclusive: "2026-11-01",
        ...extra,
      }),
    ).data;

  it("ranks routes with chips for all games, fallbacks and bar widths", () => {
    const data = breakdown("route", { locale: "ru" });
    if (data.dimension !== "route") throw new Error("ROUTE_EXPECTED");
    const view = breakdownRows(data);
    expect(view.chips).toBe(true);
    expect(view.rows.map((row) => [row.game, row.acceptedTrips])).toEqual([
      ["ats", 9],
      ["ets2", 8],
      ["ats", 6],
      ["ets2", 5],
      ["ets2", 3],
    ]);
    expect(view.rows.map((row) => row.barPercent)).toEqual(
      [9, 8, 6, 5, 3].map((trips) => (trips / 9) * 100),
    );
    // Only Wien lacks a Russian name.
    expect(view.rows.map((row) => row.fallback)).toEqual([false, false, false, true, false]);
    expect(view.rows[1]?.labels.map(({ role, label }) => [role, label.label])).toEqual([
      ["origin", "Мюнхен"],
      ["destination", "Варшава"],
    ]);
    expect(view.remainder).toBe(8);
    expect(view.undetermined).toBe(3);
    expect(new Set(view.rows.map((row) => row.key)).size).toBe(5);
  });

  it("omits chips for one game and the remainder and undetermined rows at zero", () => {
    const data = breakdown("cargo", { game: "ats", locale: "en" });
    if (data.dimension !== "cargo") throw new Error("CARGO_EXPECTED");
    const view = breakdownRows(data);
    expect(view.chips).toBe(false);
    expect(view.rows.map((row) => row.labels.map(({ label }) => label.label))).toEqual([
      ["Lumber"],
      ["Gravel"],
    ]);
    expect([view.remainder, view.undetermined]).toEqual([4, 2]);
    const zero = { acceptedTrips: 0, actualDistanceM: "0" };
    const bare = breakdownRows({ ...data, remainder: zero, undetermined: zero });
    expect([bare.remainder, bare.undetermined]).toEqual([null, null]);
  });

  it("is empty only for a zero total, not for undetermined trips alone", () => {
    const empty = makeBreakdownFixture(new URLSearchParams({ dimension: "route" }), true).data;
    expect(breakdownEmpty(empty)).toBe(true);
    // The unrecognized fixture: every trip undetermined, no ranked items and no remainder.
    const onlyUndetermined = makeBreakdownFixture(
      new URLSearchParams({ dimension: "route" }),
      false,
      true,
    ).data;
    if (onlyUndetermined.dimension !== "route") throw new Error("ROUTE_EXPECTED");
    expect(breakdownEmpty(onlyUndetermined)).toBe(false);
    expect(breakdownRows(onlyUndetermined)).toEqual({
      rows: [],
      chips: true,
      remainder: null,
      undetermined: 42,
    });
  });

  it("adds the undetermined part of the source fixture with its count and share", () => {
    const data = makeBreakdownFixture(
      new URLSearchParams({ dimension: "source" }),
      false,
      true,
    ).data;
    if (data.dimension !== "source") throw new Error("SOURCE_EXPECTED");
    // 29, 10 and 3 of 42, rounded per part.
    expect(sourceShares(data)).toEqual([
      { source: "ets2telemetry", acceptedTrips: 29, percent: 69 },
      { source: "manual", acceptedTrips: 10, percent: 24 },
      { source: "undetermined", acceptedTrips: 3, percent: 7 },
    ]);
  });

  it("shares the source split per part and adds undetermined trips only when present", () => {
    const data = breakdown("source");
    if (data.dimension !== "source") throw new Error("SOURCE_EXPECTED");
    // 32 and 10 of 42, rounded per part.
    expect(sourceShares(data)).toEqual([
      { source: "ets2telemetry", acceptedTrips: 32, percent: 76 },
      { source: "manual", acceptedTrips: 10, percent: 24 },
    ]);
    const thirds = {
      ...data,
      totals: { acceptedTrips: 3, actualDistanceM: "3" },
      items: [
        { source: "ets2telemetry" as const, acceptedTrips: 1, actualDistanceM: "1" },
        { source: "manual" as const, acceptedTrips: 1, actualDistanceM: "1" },
      ],
      undetermined: { acceptedTrips: 1, actualDistanceM: "1" },
    };
    expect(sourceShares(thirds).map((part) => [part.source, part.percent])).toEqual([
      ["ets2telemetry", 33],
      ["manual", 33],
      ["undetermined", 33],
    ]);
    const telemetryOnly = {
      ...data,
      totals: { acceptedTrips: 5, actualDistanceM: "5" },
      items: [
        { source: "ets2telemetry" as const, acceptedTrips: 5, actualDistanceM: "5" },
        { source: "manual" as const, acceptedTrips: 0, actualDistanceM: "0" },
      ],
    };
    expect(sourceShares(telemetryOnly).map((part) => part.percent)).toEqual([100, 0]);
    const empty = makeBreakdownFixture(new URLSearchParams({ dimension: "source" }), true).data;
    if (empty.dimension !== "source") throw new Error("SOURCE_EXPECTED");
    expect(sourceShares(empty)).toEqual([]);
    expect(formatPercent(76, "en")).toBe("76%");
    expect(formatPercent(76, "ru")).toMatch(/^76\s%$/);
  });

  it("chooses the plural form of a trip count", () => {
    expect([1, 2, 5, 21].map((count) => tripsKey(count, "en"))).toEqual([
      "tripsOne",
      "tripsOther",
      "tripsOther",
      "tripsOther",
    ]);
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((count) => tripsKey(count, "ru"))).toEqual([
      "tripsOne",
      "tripsFew",
      "tripsMany",
      "tripsMany",
      "tripsOne",
      "tripsFew",
      "tripsMany",
      "tripsMany",
    ]);
  });
});

describe("overview statistics translations", () => {
  const { en, ru } = dashboardTranslations;

  it("keeps the new RU and EN keys and placeholders identical", () => {
    expect(keys(en.breakdowns)).toEqual(keys(ru.breakdowns));
    for (const section of ["breakdowns", "metrics", "leaderboard", "filters"] as const)
      for (const [key, text] of Object.entries(en[section]))
        expect(placeholders(ru[section][key as keyof (typeof ru)[typeof section]]), key).toEqual(
          placeholders(text),
        );
    for (const key of [
      "myPlace",
      "placeOf",
      "placeTotals",
      "notRanked",
      "noTrips",
      "activeMembers",
    ])
      expect(keys(en.metrics)).toContain(key);
    for (const key of ["tripsOne", "tripsFew", "tripsMany", "tripsOther"] as const) {
      expect(placeholders(en.breakdowns[key])).toEqual(["trips"]);
      expect(placeholders(ru.breakdowns[key])).toEqual(["trips"]);
    }
    // No i18next plural suffixes, which would differ between the languages.
    expect(keys(en).filter((key) => /_(one|few|many|other|zero)$/.test(key))).toEqual([]);
    expect([en.leaderboard.you, ru.leaderboard.you]).toEqual(["you", "вы"]);
    expect([en.metrics.placeOf, ru.metrics.placeOf]).toEqual([
      "{{position}} of {{ranked}}",
      "{{position}} из {{ranked}}",
    ]);
  });
});

describe("overview statistics fixtures", () => {
  it("parse with the browser runtime schemas", () => {
    const company = schema("AnalyticsStage4CompanyEnvelope");
    for (const fixture of [
      makeAnalyticsFixture(),
      makeAnalyticsFixture(true),
      makeAllTimeAnalyticsFixture(),
      makeAllTimeAnalyticsFixture("ats"),
      makeAllTimeAnalyticsFixture(undefined, true),
      makeFilteredAnalyticsFixture(new URLSearchParams({ game: "ets2", granularity: "month" })),
      makeFilteredAnalyticsFixture(new URLSearchParams({ period: "all_time", game: "ats" })),
      analyticsWithoutStage4(makeAnalyticsFixture()),
    ])
      expect(company.safeParse(fixture).success).toBe(true);
    expect(schema("EnvelopeAnalytics").safeParse(makeMemberAnalyticsFixture()).success).toBe(true);
    // The member analytics shape is closed: Stage 4 aggregates do not belong there.
    expect(schema("EnvelopeAnalytics").safeParse(makeAnalyticsFixture()).success).toBe(false);

    const board = schema("EnvelopeListLeaderboardEntry");
    for (const viewer of ["unranked", "onPage", "offPage", "absent"] as const)
      for (const period of ["range", "all_time"])
        expect(
          board.safeParse(
            makeLeaderboardFixture({ viewer, search: new URLSearchParams({ period }) }),
          ).success,
        ).toBe(true);
    expect(board.safeParse(makeLeaderboardFixture({ empty: true })).success).toBe(true);

    const breakdowns = schema("AnalyticsStage4BreakdownEnvelope");
    for (const dimension of ["route", "cargo", "source"] as const)
      for (const locale of ["en", "ru"])
        for (const game of [undefined, "ets2", "ats"])
          for (const period of [undefined, "all_time"])
            for (const [empty, unrecognized] of [
              [false, false],
              [true, false],
              [false, true],
            ] as const) {
              const search = new URLSearchParams({
                dimension,
                locale,
                ...(game ? { game } : {}),
                ...(period ? { period } : {}),
              });
              const fixture = makeBreakdownFixture(search, empty, unrecognized);
              expect(breakdowns.safeParse(fixture).success, search.toString()).toBe(true);
              // Items, remainder and undetermined add up to the totals.
              const { items, remainder, undetermined, totals } = fixture.data;
              const listed = (items as { acceptedTrips: number }[]).reduce(
                (total, item) => total + item.acceptedTrips,
                0,
              );
              expect(listed + remainder.acceptedTrips + undetermined.acceptedTrips).toBe(
                totals.acceptedTrips,
              );
            }
    // The breakdown totals agree with the analytics totals for the same filters, also when
    // trips are unrecognized.
    for (const game of ["ets2", "ats"] as const)
      for (const dimension of ["route", "cargo", "source"] as const)
        for (const unrecognized of [false, true])
          expect(
            makeBreakdownFixture(new URLSearchParams({ dimension, game }), false, unrecognized).data
              .totals.acceptedTrips,
          ).toBe(makeFilteredAnalyticsFixture(new URLSearchParams({ game })).data.acceptedTrips);
  });

  it("keep active drivers equal to the ranked members when asked", () => {
    const board = makeLeaderboardFixture({ viewer: "offPage" });
    const analytics = withActiveDrivers(makeAnalyticsFixture(), board.data.rankedMembers);
    expect(analytics.data.activeDrivers).toBe(15);
    expect(board.data.rankedMembers).toBe(15);
    const allTime = new URLSearchParams({ period: "all_time" });
    expect(
      withActiveDrivers(
        makeAllTimeAnalyticsFixture(),
        makeLeaderboardFixture({ viewer: "offPage", search: allTime }).data.rankedMembers,
      ).data.activeDrivers,
    ).toBe(15);
    // A computed zero and an API without Stage 4 fields stay as they are.
    expect(withActiveDrivers(makeAnalyticsFixture(true), 15).data.activeDrivers).toBe(0);
    const bare = analyticsWithoutStage4(makeAnalyticsFixture());
    expect("activeDrivers" in withActiveDrivers(bare, 15).data).toBe(false);
  });

  it("cover the catalog label cases and reject a body for another dimension", () => {
    const ru = makeBreakdownFixture(new URLSearchParams({ dimension: "route", locale: "ru" })).data;
    if (ru.dimension !== "route") throw new Error("ROUTE_EXPECTED");
    const labels = ru.items.flatMap((item) => [item.origin, item.destination]);
    expect(labels.filter((label) => label.englishFallback).map((label) => label.label)).toEqual([
      "Wien",
    ]);
    expect(labels.some((label) => label.hidden)).toBe(true);
    expect(labels.find((label) => label.nameNative)?.nameNative).toBe("München");
    const en = makeBreakdownFixture(new URLSearchParams({ dimension: "route", locale: "en" })).data;
    if (en.dimension !== "route") throw new Error("ROUTE_EXPECTED");
    expect(en.items.flatMap((item) => [item.origin.entityId, item.destination.entityId])).toEqual(
      labels.map((label) => label.entityId),
    );
    // A route body that claims to be the source split fails the discriminated union.
    const route = makeBreakdownFixture(new URLSearchParams({ dimension: "route" }));
    const wrong = { ...route, data: { ...route.data, dimension: "source" } };
    expect(schema("AnalyticsStage4BreakdownEnvelope").safeParse(wrong).success).toBe(false);
  });
});
