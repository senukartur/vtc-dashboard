import { createRequire } from "node:module";
import type { components } from "@vtc/contracts";
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "../../apps/web/src/app/session-cache.ts";
import {
  refreshWorkspaceSummary,
  workspaceSummaryKey,
} from "../../apps/web/src/app/workspace-summary-cache.ts";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { AccountFailure } from "../../apps/web/src/features/account/transport.ts";
import { dashboardTranslations } from "../../apps/web/src/features/dashboard/translations.ts";
import {
  DashboardFailure,
  dashboardRead,
  schema,
} from "../../apps/web/src/features/dashboard/transport.ts";
import {
  blockView,
  type Countdown,
  countdown,
  type QueryView,
  RECENT_TRIPS_LIMIT,
  recentTripRow,
  recentTripsPath,
  responsePressed,
  retainsError,
  rsvpView,
  untilAnchored,
  visibleActionSections,
} from "../../apps/web/src/features/dashboard/view-model.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";
import {
  makeCompanyStatsFixture,
  makeOptionalEventFixture,
  makeRecentTripsFixture,
  makeResponseCountsFixture,
  makeRsvpFixture,
  nextUpcomingEvent,
  overviewNow,
  recentTripItems,
  recentTrips,
  upcomingEvent,
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
