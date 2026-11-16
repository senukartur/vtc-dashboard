import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import {
  analyticsWithoutStage4,
  type BreakdownDimension,
  type FixtureLocale,
  type LeaderboardViewer,
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
  recentTrips,
  upcomingEvent,
  withActiveDrivers,
} from "./dashboard-fixtures.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];

export const member1Id = "41000000-0000-4000-8000-000000000001";
export const member2Id = "41000000-0000-4000-8000-000000000002";
export const formerMemberId = "41000000-0000-4000-8000-000000000003";
export const levelIdEts2 = "50000000-0000-4000-8000-000000000002";
export const levelIdAts = "50000000-0000-4000-8000-000000000001";

// The analytics and leaderboard builders moved to the pure fixtures module (VTC-148); the specs
// keep importing them from here.
export {
  gameBuckets,
  makeAnalyticsFixture,
  makeFilteredAnalyticsFixture,
  makeLeaderboardFixture,
  makeSizedLeaderboardFixture,
} from "./dashboard-fixtures.ts";

const meta = { requestId: "synthetic-dashboard-request" };

export function makeMembersListFixture() {
  return {
    data: {
      items: [
        {
          id: member1Id,
          nickname: "AlphaDriver",
          formerMember: false,
          roles: ["director" as const, "driver" as const],
        },
        {
          id: member2Id,
          nickname: "BetaHauler",
          formerMember: false,
          roles: ["dispatcher" as const, "driver" as const],
        },
        {
          id: formerMemberId,
          nickname: "GammaRetired",
          formerMember: true,
          roles: ["driver" as const],
        },
      ],
      nextCursor: null,
    },
    meta,
  };
}

export function makeMemberProfileFixture(memberId: string) {
  const isFormer = memberId === formerMemberId;
  const nickname =
    memberId === member1Id ? "AlphaDriver" : memberId === member2Id ? "BetaHauler" : "GammaRetired";

  return {
    data: {
      member: {
        id: memberId,
        nickname,
        formerMember: isFormer,
        roles: isFormer ? ["driver" as const] : ["driver" as const, "dispatcher" as const],
      },
      qualifications: isFormer
        ? []
        : [
            {
              id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
              periodId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
              game: "ets2" as const,
              levelId: levelIdEts2,
              assignedAt: "2026-10-01T10:00:00.000Z",
            },
            {
              id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5d",
              periodId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5d",
              game: "ats" as const,
              levelId: levelIdAts,
              assignedAt: "2026-10-01T10:00:00.000Z",
            },
          ],
    },
    meta,
  };
}

export function makeProgressFixture(game: "ets2" | "ats") {
  return {
    data: {
      assignment: {
        id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
        periodId: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5c",
        game,
        levelId: game === "ets2" ? levelIdEts2 : levelIdAts,
        assignedAt: "2026-10-01T10:00:00.000Z",
      },
      acceptedTrips: 15,
      actualDistanceM: "45000000",
      requiredTrips: 20,
      requiredDistanceM: "60000000",
      eligibleForConfirmation: false,
      reviewRequired: false,
      computedAt: "2026-10-26T12:00:00.000Z",
      projectionVersion: 1,
      projectionPending: false as const,
      reviewReasonCodes: [],
    },
    meta,
  };
}

export function makeQualificationLevelsFixture(game: "ets2" | "ats") {
  return {
    data: {
      items: [
        {
          id: game === "ets2" ? levelIdEts2 : levelIdAts,
          game,
          position: game === "ets2" ? 3 : 2,
          terminal: false,
          promotionConfigured: false,
          name: game === "ets2" ? "European Driver II" : "Pacific Driver III",
          version: 1,
          ruleVersionId: null,
          configured: false,
          freightRuleSummary: null,
          requiredTrips: null,
          requiredDistanceM: null,
        },
      ],
      nextCursor: null,
    },
    meta,
  } satisfies components["schemas"]["EnvelopeListQualificationLevel"];
}

export function makeTripSummaryListFixture(ownerId: string = member1Id) {
  return {
    data: {
      items: [
        {
          view: "summary" as const,
          id: "018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a99",
          version: 1,
          owner: {
            id: ownerId,
            nickname: "AlphaDriver",
            formerMember: false,
            roles: ["driver" as const],
          },
          game: "ets2" as const,
          outcome: "delivered" as const,
          decision: "accepted" as const,
          origin: {
            entityId: "60000000-0000-4000-8000-000000000001",
            label: "Berlin",
            requestedLocale: "en" as const,
            renderedLocale: "en" as const,
            englishFallback: false,
            hidden: false,
          },
          destination: {
            entityId: "60000000-0000-4000-8000-000000000002",
            label: "Warszawa",
            requestedLocale: "en" as const,
            renderedLocale: "en" as const,
            englishFallback: false,
            hidden: false,
          },
          cargo: {
            entityId: "63000000-0000-4000-8000-000000000021",
            label: "Medical Vaccines",
            requestedLocale: "en" as const,
            renderedLocale: "en" as const,
            englishFallback: false,
            hidden: false,
          },
          actualDistanceM: "580000",
          reportingAt: "2026-10-20T14:30:00.000Z",
          sourceKinds: ["ets2telemetry" as const],
          recording: "complete" as const,
          reportingBasis: "actual_completion" as const,
        },
      ],
      nextCursor: null,
    },
    meta,
  };
}

/** The nearest convoy; it starts in 2099 so the fixture never passes the real clock. */
export function makeUpcomingEventFixture() {
  return makeOptionalEventFixture(upcomingEvent);
}

export type DashboardEndpoint =
  | "analytics"
  | "leaderboard"
  | "progress"
  | "review"
  | "companyTrips"
  | "event"
  | "myResponse"
  | "counts"
  | "rsvp"
  | "summary"
  | "stats"
  | "breakdownRoute"
  | "breakdownCargo"
  | "breakdownSource";

const breakdownEndpoint = {
  route: "breakdownRoute",
  cargo: "breakdownCargo",
  source: "breakdownSource",
} as const satisfies Record<BreakdownDimension, DashboardEndpoint>;
/** Endpoints that take the period parameters. */
const periodEndpoints: readonly DashboardEndpoint[] = [
  "analytics",
  "leaderboard",
  ...Object.values(breakdownEndpoint),
];

/** Planned outcome of the next RSVP PUT: a failure status (with Retry-After) or a network abort. */
export type RsvpOutcome = { status: number; retryAfter?: number } | "abort";

/** One intercepted RSVP command with its lower-cased request headers and JSON body. */
export interface RsvpCommand {
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** Mutable mock state returned to the test; changes apply to the next matching request. */
export interface DashboardMockState {
  /** Every intercepted `/api/v1/**` request URL, in order. */
  requests: URL[];
  /** HTTP status to return instead of the fixture for an endpoint. */
  failures: Partial<Record<DashboardEndpoint, number>>;
  /** Full `/me` capability list; undefined keeps the default staff fixture. */
  capabilities: string[] | undefined;
  summary: S["WorkspaceSummary"];
  /** Holds company analytics responses until `releaseAnalytics` is called. */
  holdAnalytics(): void;
  releaseAnalytics(): void;
  /** Holds every response of an endpoint until `release` is called for it. */
  hold(endpoint: DashboardEndpoint): void;
  release(endpoint: DashboardEndpoint): void;
  /** `scope=company` trips; undefined keeps the five-trip fixture in `tripLocale`. */
  companyTrips: S["EnvelopeListTripSummary"] | undefined;
  /**
   * Locale the API renders catalog labels in. Switching the UI language is local to the browser,
   * so a test in Russian sets it to match.
   */
  tripLocale: FixtureLocale;
  /** What `/me/upcoming-event` returns (null: no scheduled event). */
  upcoming: S["EventPublic"] | null;
  /** The member's own response; a successful PUT replaces it with the next version. */
  response: S["Rsvp"];
  /** Response counts; a successful PUT moves the member between them. */
  counts: S["EventResponseCounts"];
  /** Every RSVP PUT, including failed and aborted ones. */
  commands: RsvpCommand[];
  /** Outcomes consumed by the next RSVP PUTs before they succeed again. */
  rsvpOutcomes: RsvpOutcome[];
  /** Zone in the public company stats; null returns the unavailable month. */
  reportingTimezone: string | null;
  /** The viewer's place in the leaderboard (default: not ranked). */
  leaderboardViewer: LeaderboardViewer;
  /** Breakdowns answer a computed zero for the period. */
  emptyBreakdowns: boolean;
  /** Breakdowns with unrecognized trips: routes and cargo only undetermined, a third source part. */
  unrecognizedBreakdowns: boolean;
  /** False answers analytics and the leaderboard without their Stage 4 fields. */
  stage4: boolean;
  /** Requests answered with 422 because they break the API's period or limit rules. */
  rejected: URL[];
}

/**
 * The API's 422 rules for the period parameters: all time forbids dates, a range needs both,
 * company analytics rejects day buckets for all time, and the source split rejects `limit`.
 */
function invalidQuery(endpoint: DashboardEndpoint, search: URLSearchParams) {
  const period = search.get("period") ?? "range";
  const dated = search.has("fromDate") || search.has("toDateExclusive");
  if (period !== "range" && period !== "all_time") return true;
  if (period === "all_time" && dated) return true;
  if (period === "range" && !(search.has("fromDate") && search.has("toDateExclusive"))) return true;
  if (endpoint === "analytics" && period === "all_time" && search.get("granularity") === "day")
    return true;
  if (endpoint === "breakdownSource" && search.has("limit")) return true;
  const limit = Number(search.get("limit") ?? 1);
  if (endpoint === "leaderboard" && !(limit >= 1 && limit <= 100)) return true;
  if (endpoint.startsWith("breakdown") && !(limit >= 1 && limit <= 10)) return true;
  return false;
}

/** The mocked endpoint of a request; trips are split by scope, my-response by method. */
function endpointOf(method: string, url: URL): DashboardEndpoint | undefined {
  const path = url.pathname;
  if (path === "/api/v1/analytics/company") return "analytics";
  if (path === "/api/v1/analytics/leaderboard") return "leaderboard";
  if (path === "/api/v1/analytics/company/breakdown") {
    const dimension = url.searchParams.get("dimension");
    return dimension === "route" || dimension === "cargo" || dimension === "source"
      ? breakdownEndpoint[dimension]
      : undefined;
  }
  if (path === "/api/v1/me/qualification-progress") return "progress";
  if (path === "/api/v1/me/upcoming-event") return "event";
  if (path === "/api/v1/me/workspace-summary") return "summary";
  if (path === "/api/v1/public/company-stats") return "stats";
  if (path === "/api/v1/trips") {
    const scope = url.searchParams.get("scope");
    return scope === "review" ? "review" : scope === "company" ? "companyTrips" : undefined;
  }
  if (/^\/api\/v1\/events\/[^/]+\/my-response$/.test(path))
    return method === "PUT" ? "rsvp" : "myResponse";
  if (/^\/api\/v1\/events\/[^/]+\/response-counts$/.test(path)) return "counts";
  return undefined;
}

const etagOf = (response: S["Rsvp"]) => `"v${response.version}"`;

export async function mockDashboardRoutes(
  page: Page,
  options: {
    emptyCompany?: boolean;
    qualificationLevels?: "unavailable" | "missing";
    /** Answer analytics per requested game/granularity (see makeFilteredAnalyticsFixture). */
    filterAware?: boolean;
    failures?: Partial<Record<DashboardEndpoint, number>>;
    capabilities?: string[];
    holdAnalytics?: boolean;
    /** Ranked members (default 2, or 15 with the viewer below the page). */
    leaderboardSize?: number;
    leaderboardViewer?: LeaderboardViewer;
    leaderboardNextCursor?: boolean;
    /** Public company stats zone (default Europe/Moscow); null: no reporting timezone. */
    reportingTimezone?: string | null;
  } = {},
): Promise<DashboardMockState> {
  const gates = new Map<DashboardEndpoint, { promise: Promise<void>; release: () => void }>();
  // Replayed idempotency keys return the stored result without another change.
  const replays = new Map<string, { body: S["EnvelopeRsvp"]; etag: string }>();
  const state: DashboardMockState = {
    requests: [],
    failures: { ...options.failures },
    capabilities: options.capabilities ? [...options.capabilities] : undefined,
    summary: {
      computedAt: "2026-11-12T08:00:00.000Z",
      tripsNeedingFixes: { count: 0, items: [] },
      unfinishedManualDrafts: { count: 0, items: [] },
      unansweredUpcomingEvents: { count: 0, items: [] },
      reviewQueue: { count: 0, oldestAgeSeconds: null },
    },
    hold(endpoint) {
      if (gates.has(endpoint)) return;
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.set(endpoint, { promise, release });
    },
    release(endpoint) {
      gates.get(endpoint)?.release();
      gates.delete(endpoint);
    },
    holdAnalytics() {
      state.hold("analytics");
    },
    releaseAnalytics() {
      state.release("analytics");
    },
    companyTrips: undefined,
    tripLocale: "en",
    upcoming: upcomingEvent,
    response: makeRsvpFixture().data,
    counts: makeResponseCountsFixture().data,
    commands: [],
    rsvpOutcomes: [],
    reportingTimezone:
      options.reportingTimezone === undefined ? "Europe/Moscow" : options.reportingTimezone,
    leaderboardViewer: options.leaderboardViewer ?? "unranked",
    emptyBreakdowns: false,
    unrecognizedBreakdowns: false,
    stage4: true,
    rejected: [],
  };
  if (options.holdAnalytics) state.holdAnalytics();
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.requests.push(url);
    const endpoint = endpointOf(request.method(), url);
    const summary = state.summary;
    if (endpoint === "rsvp")
      state.commands.push({
        url,
        headers: await request.allHeaders(),
        body: request.postDataJSON(),
      });
    const gate = endpoint && gates.get(endpoint);
    if (gate) await gate.promise;
    const failure = endpoint && state.failures[endpoint];
    if (failure)
      return route.fulfill({ status: failure, json: { error: { code: "SYNTHETIC_FAILURE" } } });
    if (
      endpoint &&
      periodEndpoints.includes(endpoint) &&
      invalidQuery(endpoint, url.searchParams)
    ) {
      state.rejected.push(url);
      return route.fulfill({ status: 422, json: { error: { code: "VALIDATION_FAILED" } } });
    }

    if (path === "/api/v1/auth/csrf") {
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    }
    if (path === "/api/v1/me") {
      const self = accountFixture("en");
      if (state.capabilities) self.data.capabilities = [...state.capabilities];
      else self.data.capabilities.push("trips.review", "company.read");
      return route.fulfill({ json: self });
    }
    const leaderboardFor = (search: URLSearchParams) =>
      makeLeaderboardFixture({
        empty: options.emptyCompany ?? false,
        ...(options.leaderboardSize !== undefined ? { size: options.leaderboardSize } : {}),
        nextCursor: options.leaderboardNextCursor ?? false,
        viewer: state.leaderboardViewer,
        search,
      });
    if (endpoint === "analytics") {
      const game = url.searchParams.get("game");
      const answered = options.filterAware
        ? makeFilteredAnalyticsFixture(url.searchParams, options.emptyCompany)
        : url.searchParams.get("period") === "all_time"
          ? makeAllTimeAnalyticsFixture(
              game === "ets2" || game === "ats" ? game : undefined,
              options.emptyCompany,
            )
          : makeAnalyticsFixture(options.emptyCompany);
      // With a ranked viewer the active drivers equal the leaderboard's ranked members.
      const ranked = state.leaderboardViewer === "onPage" || state.leaderboardViewer === "offPage";
      const fixture = ranked
        ? withActiveDrivers(answered, leaderboardFor(url.searchParams).data.rankedMembers)
        : answered;
      return route.fulfill({ json: state.stage4 ? fixture : analyticsWithoutStage4(fixture) });
    }
    if (endpoint === "leaderboard") {
      const fixture = leaderboardFor(url.searchParams);
      return route.fulfill({ json: state.stage4 ? fixture : leaderboardWithoutStage4(fixture) });
    }
    if (endpoint && Object.values<string>(breakdownEndpoint).includes(endpoint)) {
      return route.fulfill({
        json: makeBreakdownFixture(
          url.searchParams,
          state.emptyBreakdowns,
          state.unrecognizedBreakdowns,
        ),
      });
    }
    if (path === "/api/v1/me/trip-status-summary") {
      return route.fulfill({
        json: {
          data: {
            counts: { unassessed: 1, pendingReview: 2, accepted: 15, rejected: 0 },
            activeTrips: 1,
            correctionPending: 0,
          },
          meta,
        },
      });
    }
    if (endpoint === "event") {
      return route.fulfill({ json: makeOptionalEventFixture(state.upcoming) });
    }
    if (endpoint === "summary") {
      const { reviewQueue, ...sections } = summary;
      return route.fulfill({
        json: { data: { ...sections, legacyReviewQueue: reviewQueue }, meta },
      });
    }
    if (endpoint === "stats") {
      return route.fulfill({ json: makeCompanyStatsFixture(state.reportingTimezone) });
    }
    if (endpoint === "myResponse") {
      return route.fulfill({
        json: { data: state.response, meta },
        headers: { ETag: etagOf(state.response) },
      });
    }
    if (endpoint === "counts") {
      return route.fulfill({ json: { data: { ...state.counts }, meta } });
    }
    if (endpoint === "rsvp") {
      const outcome = state.rsvpOutcomes.shift();
      if (outcome === "abort") return route.abort("failed");
      if (outcome)
        return route.fulfill({
          status: outcome.status,
          headers: outcome.retryAfter ? { "Retry-After": String(outcome.retryAfter) } : {},
          json: { error: { code: "SYNTHETIC_FAILURE" } },
        });
      const headers = await request.allHeaders();
      const key = headers["idempotency-key"] ?? "";
      const replay = replays.get(key);
      if (replay) return route.fulfill({ json: replay.body, headers: { ETag: replay.etag } });
      if (headers["if-match"] !== etagOf(state.response))
        return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
      const input = request.postDataJSON() as S["RsvpInput"];
      const before = state.response.response;
      const counts = { ...state.counts };
      if (before === "participating") counts.participating -= 1;
      if (before === "declined") counts.declined -= 1;
      if (input.response === "participating") counts.participating += 1;
      if (input.response === "declined") counts.declined += 1;
      state.counts = counts;
      state.response = {
        response: input.response,
        version: state.response.version + 1,
        declineReason: input.response === "declined" ? input.reason : null,
      };
      const body = { data: state.response, meta };
      replays.set(key, { body, etag: etagOf(state.response) });
      return route.fulfill({ json: body, headers: { ETag: etagOf(state.response) } });
    }
    if (path === "/api/v1/me/qualification-progress") {
      const game = (url.searchParams.get("game") ?? "ets2") as "ets2" | "ats";
      return route.fulfill({ json: makeProgressFixture(game) });
    }
    if (path === "/api/v1/qualification-levels") {
      if (options.qualificationLevels === "unavailable")
        return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
      const game = url.searchParams.get("game") === "ats" ? "ats" : "ets2";
      const fixture = makeQualificationLevelsFixture(game);
      if (options.qualificationLevels === "missing") fixture.data.items = [];
      return route.fulfill({ json: fixture });
    }
    if (path === "/api/v1/members") {
      return route.fulfill({ json: makeMembersListFixture() });
    }
    if (path.startsWith("/api/v1/members/") && path.endsWith("/analytics")) {
      return route.fulfill({ json: makeMemberAnalyticsFixture() });
    }
    if (path.startsWith("/api/v1/members/") && path.endsWith("/qualification-progress")) {
      const game = (url.searchParams.get("game") ?? "ets2") as "ets2" | "ats";
      return route.fulfill({ json: makeProgressFixture(game) });
    }
    if (path.startsWith("/api/v1/members/")) {
      const memberId = path.split("/").pop() ?? member1Id;
      return route.fulfill({ json: makeMemberProfileFixture(memberId) });
    }
    if (endpoint === "companyTrips") {
      return route.fulfill({
        json: state.companyTrips ?? makeRecentTripsFixture(recentTrips(state.tripLocale)),
      });
    }
    if (path === "/api/v1/trips") {
      return route.fulfill({ json: makeTripSummaryListFixture() });
    }

    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return state;
}
