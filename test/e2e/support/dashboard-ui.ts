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

export async function mockDashboardRoutes(
  page: Page,
  options: {
    emptyCompany?: boolean;
    qualificationLevels?: "unavailable" | "missing";
  } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/v1/auth/csrf") {
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    }
    if (path === "/api/v1/me") {
      const self = accountFixture("en");
      self.data.capabilities.push("trips.review", "company.read");
      return route.fulfill({ json: self });
    }
    if (path === "/api/v1/analytics/company") {
      return route.fulfill({ json: makeAnalyticsFixture(options.emptyCompany) });
    }
    if (path === "/api/v1/analytics/leaderboard") {
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
      return route.fulfill({ json: makeTripSummaryListFixture() });
    }

    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
}
