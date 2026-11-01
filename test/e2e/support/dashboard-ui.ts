import { inertNotifications } from "./notifications.ts";
import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";

export const member1Id = "41000000-0000-4000-8000-000000000001";
export const member2Id = "41000000-0000-4000-8000-000000000002";
export const formerMemberId = "41000000-0000-4000-8000-000000000003";
export const levelIdEts2 = "50000000-0000-4000-8000-000000000002";
export const levelIdAts = "50000000-0000-4000-8000-000000000001";

const meta = { requestId: "synthetic-dashboard-request" };

export function makeAnalyticsFixture(empty = false) {
  if (empty) {
    return {
      data: {
        acceptedTrips: 0,
        actualDistanceM: "0",
        reportingTimezone: "Europe/Moscow",
        fromDate: "2026-10-01",
        toDateExclusive: "2026-11-01",
        granularity: "day" as const,
        buckets: [],
        computedAt: "2026-10-26T12:00:00.000Z",
        projectionVersion: 1,
        projectionPending: false,
      },
      meta,
    };
  }

  return {
    data: {
      acceptedTrips: 42,
      actualDistanceM: "125430000", // 125,430 km
      reportingTimezone: "Europe/Moscow",
      fromDate: "2026-10-01",
      toDateExclusive: "2026-11-01",
      granularity: "day" as const,
      buckets: [
        { date: "2026-10-01", acceptedTrips: 5, actualDistanceM: "15000000" },
        { date: "2026-10-02", acceptedTrips: 12, actualDistanceM: "38000000" },
        { date: "2026-10-03", acceptedTrips: 8, actualDistanceM: "24000000" },
        { date: "2026-10-04", acceptedTrips: 17, actualDistanceM: "48430000" }, // max bar
      ],
      computedAt: "2026-10-26T12:00:00.000Z",
      projectionVersion: 2,
      projectionPending: false,
    },
    meta,
  };
}

export function makeLeaderboardFixture(empty = false) {
  if (empty) {
    return { data: { items: [], nextCursor: null }, meta };
  }

  return {
    data: {
      items: [
        {
          member: {
            id: member1Id,
            nickname: "AlphaDriver",
            formerMember: false,
            roles: ["director" as const, "driver" as const],
          },
          acceptedTrips: 24,
          actualDistanceM: "72000000",
        },
        {
          member: {
            id: member2Id,
            nickname: "BetaHauler",
            formerMember: false,
            roles: ["dispatcher" as const, "driver" as const],
          },
          acceptedTrips: 18,
          actualDistanceM: "53430000",
        },
      ],
      nextCursor: null,
    },
    meta,
  };
}

/** Per-game daily buckets for filter tests; ETS2 + ATS add up to the all-games fixture. */
const gameBuckets = {
  ets2: [
    { date: "2026-10-01", acceptedTrips: 3, actualDistanceM: "9000000" },
    { date: "2026-10-02", acceptedTrips: 7, actualDistanceM: "22000000" },
    { date: "2026-10-04", acceptedTrips: 10, actualDistanceM: "30430000" },
  ],
  ats: [
    { date: "2026-10-01", acceptedTrips: 2, actualDistanceM: "6000000" },
    { date: "2026-10-02", acceptedTrips: 5, actualDistanceM: "16000000" },
    { date: "2026-10-03", acceptedTrips: 8, actualDistanceM: "24000000" },
    { date: "2026-10-04", acceptedTrips: 7, actualDistanceM: "18000000" },
  ],
} as const;

/**
 * Filter-aware analytics: buckets follow the requested game and granularity, totals are the exact
 * bucket sums, and the echoed period matches the request.
 */
export function makeFilteredAnalyticsFixture(search: URLSearchParams, empty = false) {
  const base = makeAnalyticsFixture(empty);
  const game = search.get("game");
  const daily: { date: string; acceptedTrips: number; actualDistanceM: string }[] = empty
    ? []
    : game === "ets2" || game === "ats"
      ? gameBuckets[game].map((bucket) => ({ ...bucket }))
      : base.data.buckets;
  const acceptedTrips = daily.reduce((sum, bucket) => sum + bucket.acceptedTrips, 0);
  const actualDistanceM = String(
    daily.reduce((sum, bucket) => sum + BigInt(bucket.actualDistanceM), 0n),
  );
  const granularity = search.get("granularity") === "month" ? ("month" as const) : ("day" as const);
  const buckets =
    granularity === "month" && daily.length > 0
      ? [{ date: "2026-10-01", acceptedTrips, actualDistanceM }]
      : daily;
  return {
    data: {
      ...base.data,
      acceptedTrips,
      actualDistanceM,
      fromDate: search.get("fromDate") ?? base.data.fromDate,
      toDateExclusive: search.get("toDateExclusive") ?? base.data.toDateExclusive,
      granularity,
      buckets,
    },
    meta,
  };
}

/** Leaderboard with `size` fictional entries; the first two match the default fixture. */
export function makeSizedLeaderboardFixture(size: number, nextCursor: string | null = null) {
  const base = makeLeaderboardFixture(false).data.items;
  const items = Array.from({ length: size }, (_, index) => {
    const known = base[index];
    if (known) return known;
    const number = String(index + 1).padStart(3, "0");
    return {
      member: {
        id: `41000000-0000-4000-8000-000000001${number}`,
        nickname: `Fictional Driver ${number}`,
        formerMember: false,
        roles: ["driver" as const],
      },
      acceptedTrips: Math.max(1, 17 - index),
      actualDistanceM: String((200 - index) * 200000),
    };
  });
  return { data: { items, nextCursor }, meta };
}

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
          code: game === "ets2" ? "driver_ii" : "driver_iii",
          name: game === "ets2" ? "European Driver II" : "Pacific Driver III",
          version: 1,
          ruleVersionId: null,
          configured: false,
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
            retired: false,
          },
          destination: {
            entityId: "60000000-0000-4000-8000-000000000002",
            label: "Warszawa",
            requestedLocale: "en" as const,
            renderedLocale: "en" as const,
            englishFallback: false,
            retired: false,
          },
          cargo: {
            entityId: "63000000-0000-4000-8000-000000000021",
            label: "Medical Vaccines",
            requestedLocale: "en" as const,
            renderedLocale: "en" as const,
            englishFallback: false,
            retired: false,
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

export function makeUpcomingEventFixture() {
  return {
    data: {
      id: "70000000-0000-4000-8000-000000000001",
      version: 1,
      title: "Autumn Yukon Convoy 2026",
      description: "Annual Autumn European Convoy for Yukon Union drivers",
      game: "ets2" as const,
      startsAt: "2026-11-05T18:00:00.000Z",
      endsAt: "2026-11-05T21:00:00.000Z",
      status: "scheduled" as const,
      origin: null,
      destination: null,
      server: "Simulation 1",
      organizer: "Yukon Staff",
      meetingLocation: "Berlin Quarry",
      route: "Berlin -> Hamburg -> Amsterdam",
      meetingAt: "2026-11-05T17:30:00.000Z",
    },
    meta,
  };
}

export type DashboardEndpoint = "analytics" | "leaderboard" | "progress" | "review" | "event";

/** Mutable mock state returned to the test; changes apply to the next matching request. */
export interface DashboardMockState {
  /** Every intercepted `/api/v1/**` request URL, in order. */
  requests: URL[];
  /** HTTP status to return instead of the fixture for an endpoint. */
  failures: Partial<Record<DashboardEndpoint, number>>;
  /** Full `/me` capability list; undefined keeps the default staff fixture. */
  capabilities: string[] | undefined;
  /** Holds company analytics responses until `releaseAnalytics` is called. */
  holdAnalytics(): void;
  releaseAnalytics(): void;
}

const endpointPaths: Record<DashboardEndpoint, string> = {
  analytics: "/api/v1/analytics/company",
  leaderboard: "/api/v1/analytics/leaderboard",
  progress: "/api/v1/me/qualification-progress",
  review: "/api/v1/trips",
  event: "/api/v1/me/upcoming-event",
};

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
    leaderboardSize?: number;
    leaderboardNextCursor?: boolean;
    reviewNextCursor?: boolean;
  } = {},
): Promise<DashboardMockState> {
  let gate: { promise: Promise<void>; release: () => void } | undefined;
  const state: DashboardMockState = {
    requests: [],
    failures: { ...options.failures },
    capabilities: options.capabilities ? [...options.capabilities] : undefined,
    holdAnalytics() {
      if (gate) return;
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { promise, release };
    },
    releaseAnalytics() {
      gate?.release();
      gate = undefined;
    },
  };
  if (options.holdAnalytics) state.holdAnalytics();
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url());
    const path = url.pathname;
    state.requests.push(url);
    if (path === endpointPaths.analytics && gate) await gate.promise;
    for (const [endpoint, status] of Object.entries(state.failures)) {
      if (status && path === endpointPaths[endpoint as DashboardEndpoint])
        return route.fulfill({ status, json: { error: { code: "SYNTHETIC_FAILURE" } } });
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
    if (path === "/api/v1/analytics/company") {
      if (options.filterAware)
        return route.fulfill({
          json: makeFilteredAnalyticsFixture(url.searchParams, options.emptyCompany),
        });
      return route.fulfill({ json: makeAnalyticsFixture(options.emptyCompany) });
    }
    if (path === "/api/v1/analytics/leaderboard") {
      if (options.leaderboardSize !== undefined || options.leaderboardNextCursor)
        return route.fulfill({
          json: makeSizedLeaderboardFixture(
            options.leaderboardSize ?? 2,
            options.leaderboardNextCursor ? "NONFUNCTIONAL_CURSOR" : null,
          ),
        });
      return route.fulfill({ json: makeLeaderboardFixture(options.emptyCompany) });
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
    if (path === "/api/v1/me/upcoming-event") {
      return route.fulfill({ json: makeUpcomingEventFixture() });
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
      return route.fulfill({ json: makeAnalyticsFixture(false) });
    }
    if (path.startsWith("/api/v1/members/") && path.endsWith("/qualification-progress")) {
      const game = (url.searchParams.get("game") ?? "ets2") as "ets2" | "ats";
      return route.fulfill({ json: makeProgressFixture(game) });
    }
    if (path.startsWith("/api/v1/members/")) {
      const memberId = path.split("/").pop() ?? member1Id;
      return route.fulfill({ json: makeMemberProfileFixture(memberId) });
    }
    if (path === "/api/v1/trips") {
      const fixture = makeTripSummaryListFixture();
      // A full first page of the five-item review queue with more pending behind the cursor.
      if (options.reviewNextCursor) {
        const [item] = fixture.data.items;
        const items = [0, 1, 2, 3, 4].map((index) => ({
          ...item,
          id: `018f3a2b-4c5d-4e6f-8a9b-0c1d2e3f4a9${index}`,
        }));
        return route.fulfill({
          json: { ...fixture, data: { items, nextCursor: "NONFUNCTIONAL_CURSOR" } },
        });
      }
      return route.fulfill({ json: fixture });
    }

    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return state;
}
