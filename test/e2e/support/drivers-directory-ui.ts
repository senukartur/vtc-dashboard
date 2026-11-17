// Playwright mock for the drivers directory (VTC-145): a server-like listMembers with filter-bound
// cursors, the invitations list and the qualification levels, from the pure fixtures.
import type { Page } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import {
  type DirectoryOptions,
  directoryResponse,
  invitationsFixture,
  levelsFixture,
} from "./drivers-fixtures.ts";
import { inertNotifications } from "./notifications.ts";

const meta = { requestId: "synthetic-directory-request" };

export const memberCapabilities = [
  "company.read",
  "events.respond",
  "trips.read_own_private",
  "trips.submit_own",
];

export type DirectoryEndpoint = "members" | "invitations" | "levels";

export interface DirectoryMockState extends DirectoryOptions {
  /** Every intercepted `/api/v1/**` request (notification polling excluded), in order. */
  requests: URL[];
  /** Requests no handler recognised; they were answered with 404. */
  unexpected: string[];
  capabilities: string[];
  displayTimezone: string;
  /** HTTP status returned instead of the fixture for an endpoint, until deleted. */
  failures: Partial<Record<DirectoryEndpoint, number>>;
  /** Answer the next request that carries a cursor with 409, once. */
  rejectNextCursor: boolean;
  hold(endpoint: DirectoryEndpoint): void;
  release(endpoint: DirectoryEndpoint): void;
}

function endpointOf(path: string): DirectoryEndpoint | null {
  if (path === "/api/v1/members") return "members";
  if (path === "/api/v1/admin/invitations") return "invitations";
  if (path === "/api/v1/qualification-levels") return "levels";
  return null;
}

/** `/members` requests as `path?query`, in order. */
export function memberReads(state: DirectoryMockState) {
  return state.requests
    .filter((url) => url.pathname === "/api/v1/members")
    .map((url) => `/members${url.search}`);
}

/** Every `/admin/*` request path with its query, in order. */
export function adminReads(state: DirectoryMockState) {
  return state.requests
    .filter((url) => url.pathname.startsWith("/api/v1/admin"))
    .map((url) => `${url.pathname.slice("/api/v1".length)}${url.search}`);
}

export async function mockDirectoryRoutes(
  page: Page,
  options: DirectoryOptions & {
    capabilities?: string[];
    displayTimezone?: string;
    failures?: Partial<Record<DirectoryEndpoint, number>>;
  } = {},
): Promise<DirectoryMockState> {
  const gates = new Map<DirectoryEndpoint, { promise: Promise<void>; release: () => void }>();
  const state: DirectoryMockState = {
    requests: [],
    unexpected: [],
    capabilities: [...(options.capabilities ?? memberCapabilities)],
    displayTimezone: options.displayTimezone ?? "UTC",
    failures: { ...options.failures },
    rejectNextCursor: false,
    ...(options.tripsOff ? { tripsOff: true } : {}),
    ...(options.qualificationsOff ? { qualificationsOff: true } : {}),
    ...(options.empty ? { empty: true } : {}),
    ...(options.pageCap ? { pageCap: options.pageCap } : {}),
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
  };
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
      self.data.capabilities = [...state.capabilities];
      self.data.preferences.displayTimezone = state.displayTimezone;
      return route.fulfill({ json: self });
    }
    if (path === "/api/v1/me/upcoming-event") return route.fulfill({ json: { data: null, meta } });
    if (path === "/api/v1/me/workspace-summary")
      return route.fulfill({ json: { data: { computedAt: "2026-11-14T12:00:00.000Z" }, meta } });

    const endpoint = endpointOf(path);
    const gate = endpoint ? gates.get(endpoint) : undefined;
    if (gate) await gate.promise;
    const failure = endpoint ? state.failures[endpoint] : undefined;
    if (failure)
      return route.fulfill({ status: failure, json: { error: { code: "SYNTHETIC_FAILURE" } } });
    if (endpoint === "members") {
      if (state.rejectNextCursor && url.searchParams.has("cursor")) {
        state.rejectNextCursor = false;
        return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
      }
      const result = directoryResponse(url.searchParams, state);
      return route.fulfill({ status: result.status, json: result.body });
    }
    if (endpoint === "invitations") {
      if (!state.capabilities.includes("applications.manage"))
        return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } });
      return route.fulfill({
        json: invitationsFixture(url.searchParams),
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (endpoint === "levels") {
      if (state.qualificationsOff)
        return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
      return route.fulfill({
        json: levelsFixture(url.searchParams.get("game") === "ats" ? "ats" : "ets2"),
      });
    }
    state.unexpected.push(`${path}${url.search}`);
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return state;
}
