import type { Page } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { makeCompanyStatsFixture } from "./dashboard-fixtures.ts";
import {
  alphaId,
  analyticsFixture,
  betaId,
  formerId,
  levelsFixture,
  profileFixture,
  progressFixture,
  selfId,
  topId,
  tripsFixture,
} from "./drivers-fixtures.ts";
import { inertNotifications } from "./notifications.ts";

const meta = { requestId: "synthetic-driver-request" };
const knownMembers = new Set([selfId, alphaId, betaId, formerId, topId]);

export type DriverEndpoint =
  | "profile"
  | "analytics"
  | "progressEts2"
  | "progressAts"
  | "levels"
  | "trips"
  /** Public company stats: the reporting timezone that anchors the analytics window. */
  | "stats";

/** Mutable mock state; changes apply to the next matching request. */
export interface DriverMockState {
  /** Every intercepted `/api/v1/**` request URL, in order (notification polling excluded). */
  requests: URL[];
  /** Requests no handler recognised; they were answered with 404. */
  unexpected: string[];
  /** HTTP status returned instead of the fixture for an endpoint. */
  failures: Partial<Record<DriverEndpoint, number>>;
  /** Full `/me` capability list; undefined keeps the default member fixture plus company.read. */
  capabilities: string[] | undefined;
  /** Simulate a next cursor on the first accepted trips page. */
  tripsNextCursor: boolean;
  emptyTrips: boolean;
  /** Twelve trips by AlphaHauler to exercise the ten-row profile limit. */
  bulkTrips: boolean;
  emptyAnalytics: boolean;
  /** Zone in the public company stats; null returns the unavailable month. */
  reportingTimezone: string | null;
  /** Holds every response of an endpoint until `release` is called for it. */
  hold(endpoint: DriverEndpoint): void;
  release(endpoint: DriverEndpoint): void;
  holdProfile(): void;
  releaseProfile(): void;
}

function endpointOf(url: URL): DriverEndpoint | null {
  const path = url.pathname;
  if (/^\/api\/v1\/members\/[^/]+$/.test(path)) return "profile";
  if (/^\/api\/v1\/members\/[^/]+\/analytics$/.test(path)) return "analytics";
  if (/^\/api\/v1\/members\/[^/]+\/qualification-progress$/.test(path))
    return url.searchParams.get("game") === "ats" ? "progressAts" : "progressEts2";
  if (path === "/api/v1/qualification-levels") return "levels";
  if (path === "/api/v1/trips") return "trips";
  if (path === "/api/v1/public/company-stats") return "stats";
  return null;
}

/** Profile-relevant requests (members, trips, levels, admin) for exact request-set checks. */
export function profileRequests(state: DriverMockState) {
  return state.requests
    .filter(
      (url) =>
        url.pathname.startsWith("/api/v1/members") ||
        url.pathname.startsWith("/api/v1/trips") ||
        url.pathname.startsWith("/api/v1/qualification-levels") ||
        url.pathname.startsWith("/api/v1/admin"),
    )
    .map((url) => `${url.pathname}${url.search}`);
}

export async function mockDriverRoutes(
  page: Page,
  options: {
    failures?: Partial<Record<DriverEndpoint, number>>;
    capabilities?: string[];
    holdProfile?: boolean;
    tripsNextCursor?: boolean;
    emptyTrips?: boolean;
    bulkTrips?: boolean;
    emptyAnalytics?: boolean;
    /** Public company stats zone (default Europe/Moscow, as in the analytics fixture). */
    reportingTimezone?: string | null;
  } = {},
): Promise<DriverMockState> {
  const gates = new Map<DriverEndpoint, { promise: Promise<void>; release: () => void }>();
  const state: DriverMockState = {
    requests: [],
    unexpected: [],
    failures: { ...options.failures },
    capabilities: options.capabilities ? [...options.capabilities] : undefined,
    tripsNextCursor: options.tripsNextCursor ?? true,
    emptyTrips: options.emptyTrips ?? false,
    bulkTrips: options.bulkTrips ?? false,
    emptyAnalytics: options.emptyAnalytics ?? false,
    reportingTimezone:
      options.reportingTimezone === undefined ? "Europe/Moscow" : options.reportingTimezone,
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
    holdProfile() {
      state.hold("profile");
    },
    releaseProfile() {
      state.release("profile");
    },
  };
  if (options.holdProfile) state.holdProfile();
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url());
    const path = url.pathname;
    state.requests.push(url);

    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    if (path === "/api/v1/me") {
      const self = accountFixture("en");
      if (state.capabilities) self.data.capabilities = [...state.capabilities];
      return route.fulfill({ json: self });
    }
    if (path === "/api/v1/me/upcoming-event") return route.fulfill({ json: { data: null, meta } });
    if (path === "/api/v1/me/workspace-summary")
      return route.fulfill({ json: { data: { computedAt: "2026-11-12T08:00:00.000Z" }, meta } });

    const endpoint = endpointOf(url);
    const gate = endpoint ? gates.get(endpoint) : undefined;
    if (gate) await gate.promise;
    const status = endpoint ? state.failures[endpoint] : undefined;
    if (status) return route.fulfill({ status, json: { error: { code: "SYNTHETIC_FAILURE" } } });

    if (endpoint === "stats")
      return route.fulfill({ json: makeCompanyStatsFixture(state.reportingTimezone) });

    const memberId = path.split("/")[4] ?? "";
    if (endpoint === "profile") {
      if (!knownMembers.has(memberId))
        return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      return route.fulfill({ json: profileFixture(memberId) });
    }
    if (endpoint === "analytics")
      return route.fulfill({
        json: analyticsFixture(url.searchParams, { empty: state.emptyAnalytics }),
      });
    if (endpoint === "progressEts2" || endpoint === "progressAts") {
      const fixture = progressFixture(memberId, endpoint === "progressAts" ? "ats" : "ets2");
      if (!fixture)
        return route.fulfill({ status: 409, json: { error: { code: "NO_ASSIGNMENT" } } });
      return route.fulfill({ json: fixture });
    }
    if (endpoint === "levels")
      return route.fulfill({
        json: levelsFixture(url.searchParams.get("game") === "ats" ? "ats" : "ets2"),
      });
    if (endpoint === "trips")
      return route.fulfill({
        json: tripsFixture(url.searchParams, {
          nextCursor: state.tripsNextCursor,
          empty: state.emptyTrips,
          bulk: state.bulkTrips,
        }),
      });

    state.unexpected.push(path);
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return state;
}
