// Playwright mock for the drivers directory (VTC-145): a server-like listMembers with filter-bound
// cursors, the invitations list and the qualification levels, from the pure fixtures. The access
// panel (VTC-160) reads and changes the same members through a mutable Members page mock.
import type { Page, Route } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import {
  type DirectoryOptions,
  type DirectorySeed,
  directoryAdminMember,
  directoryPopulation,
  directoryProfile,
  directoryResponse,
  invitationsFixture,
  levelsFixture,
  reinstatementOptionsFixture,
} from "./drivers-fixtures.ts";
import { inertNotifications } from "./notifications.ts";

const meta = { requestId: "synthetic-directory-request" };

export const memberCapabilities = [
  "company.read",
  "events.respond",
  "trips.read_own_private",
  "trips.submit_own",
];

export type DirectoryEndpoint =
  | "members"
  | "invitations"
  | "levels"
  /** `GET /members/{id}`: the panel's join date. */
  | "profile"
  /** `GET /admin/members/{id}` and `/admin/reinstatement-options`. */
  | "admin";

/** One access command as the mock received it. */
export type AccessCommand = {
  method: string;
  path: string;
  body: string | null;
  key: string | undefined;
  ifMatch: string | undefined;
  csrf: string | undefined;
  contentType: string | undefined;
};
/** A queued command answer: a status (with an optional Retry-After) or a dropped connection. */
export type CommandOutcome = number | "abort" | { status: number; retryAfter: number };

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
  /** Every access command, in order. */
  commands: AccessCommand[];
  /** Answers for the next commands, in order; an empty queue applies the command. */
  commandOutcomes: CommandOutcome[];
  /** Member versions behind the ETags; `bump` simulates a change by another administrator. */
  versions: Map<string, number>;
  bump(id: string): void;
  hold(endpoint: DirectoryEndpoint): void;
  release(endpoint: DirectoryEndpoint): void;
}

function endpointOf(path: string): DirectoryEndpoint | null {
  if (path === "/api/v1/members") return "members";
  if (/^\/api\/v1\/members\/[^/]+$/.test(path)) return "profile";
  if (path.startsWith("/api/v1/admin/members/") || path === "/api/v1/admin/reinstatement-options")
    return "admin";
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
    commands: [],
    commandOutcomes: [],
    versions: new Map(),
    bump(id) {
      state.versions.set(id, (state.versions.get(id) ?? 1) + 1);
    },
    population: directoryPopulation(),
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
    if (endpoint === "profile") {
      const item = find(state, path.split("/")[4] ?? "");
      if (!item) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      return route.fulfill({ json: directoryProfile(item, state) });
    }
    if (endpoint === "admin") return administer(route, url, state);
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

function find(state: DirectoryMockState, id: string): DirectorySeed | undefined {
  const { active, former } = state.population ?? { active: [], former: [] };
  return [...active, ...former].find((item) => item.id === id);
}

/** The Members page reads and commands for one member, applied to the directory population. */
async function administer(route: Route, url: URL, state: DirectoryMockState) {
  const request = route.request();
  const method = request.method();
  const path = url.pathname.slice("/api/v1".length);
  if (method === "GET") {
    if (!state.capabilities.includes("members.manage"))
      return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" }, meta } });
    if (path === "/admin/reinstatement-options")
      return route.fulfill({ json: reinstatementOptionsFixture() });
  }
  const match =
    /^\/admin\/members\/([^/]+)(\/membership|\/roles|\/deactivation|\/reinstatement)?$/.exec(path);
  const item = match?.[1] ? find(state, match[1]) : undefined;
  if (!match || !item) {
    state.unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" }, meta } });
  }
  const etag = () => `"m-${state.versions.get(item.id) ?? 1}"`;
  if (method === "GET" && !match[2])
    return route.fulfill({
      json: directoryAdminMember(item, state.versions.get(item.id) ?? 1),
      headers: { ETag: etag() },
    });
  const headers = request.headers();
  state.commands.push({
    method,
    path,
    body: request.postData(),
    key: headers["idempotency-key"],
    ifMatch: headers["if-match"],
    csrf: headers["x-csrf-token"],
    contentType: headers["content-type"],
  });
  const outcome = state.commandOutcomes.shift();
  if (outcome === "abort") return route.abort("failed");
  if (outcome !== undefined) {
    const status = typeof outcome === "number" ? outcome : outcome.status;
    return route.fulfill({
      status,
      json: { error: { code: "SYNTHETIC_FAILURE", messageKey: "errors.synthetic" }, meta },
      ...(typeof outcome === "object"
        ? { headers: { "Retry-After": String(outcome.retryAfter) } }
        : {}),
    });
  }
  if (headers["if-match"] !== etag())
    return route.fulfill({ status: 412, json: { error: { code: "VERSION_CONFLICT" }, meta } });
  const body = JSON.parse(request.postData() ?? "{}") as {
    membership?: "trainee" | "driver";
    roles?: DirectorySeed["roles"];
  };
  const population = state.population ?? { active: [], former: [] };
  if (match[2] === "/membership" && body.membership)
    item.roles = [
      ...item.roles.filter((role) => role !== "trainee" && role !== "driver"),
      body.membership,
    ];
  if (match[2] === "/roles" && body.roles) item.roles = body.roles;
  if (match[2] === "/deactivation") {
    population.active.splice(population.active.indexOf(item), 1);
    population.former.push(item);
    item.former = true;
    item.roles = [];
  }
  if (match[2] === "/reinstatement" && body.roles) {
    population.former.splice(population.former.indexOf(item), 1);
    population.active.push(item);
    item.former = false;
    item.roles = body.roles;
  }
  state.bump(item.id);
  return route.fulfill({
    json: { data: { id: item.id, version: state.versions.get(item.id) }, meta },
    headers: { ETag: etag() },
  });
}
