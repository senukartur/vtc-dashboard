import type { Page, Route } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture, fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];
type Role = S["MemberSummary"]["roles"][number];
export const ids = {
  self: fixtureId,
  company: "c6500000-0000-4000-8000-000000000001",
  volga: "a6500000-0000-4000-8000-000000000001",
  kestrel: "a6500000-0000-4000-8000-000000000002",
  cedar: "a6500000-0000-4000-8000-000000000003",
  challenge: "b6500000-0000-4000-8000-000000000001",
} as const;
export const names = {
  volga: "Fictional Volga Ray",
  kestrel: "Fictional Kestrel",
  cedar: "Fictional Cedar Wolf of the Long Northern Convoy",
} as const;
export const correctCode = "fictional-nonfunctional-transfer-code";
/** Error bodies carry this placeholder; it must never render. */
export const sentinel = "PRIVATE_SENTINEL";
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-settings" } });
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();
const failure = (status: number, headers: Record<string, string> = {}) => ({
  status,
  headers,
  json: {
    error: { code: sentinel, messageKey: "errors.synthetic", retryable: false },
    meta: { requestId: "synthetic-settings" },
  },
});

/** Mirrors the server's role-to-capability rule for the synthetic session. */
function capabilities(roles: Role[]) {
  const result = new Set(["company.read", "trips.read_own_private"]);
  if (roles.some((role) => role === "trainee" || role === "driver"))
    for (const value of ["trips.submit_own", "events.respond"]) result.add(value);
  if (roles.some((role) => ["dispatcher", "deputy_director", "director"].includes(role)))
    result.add("trips.review");
  if (roles.some((role) => role === "deputy_director" || role === "director"))
    for (const value of [
      "applications.manage",
      "events.manage",
      "qualifications.manage",
      "members.manage",
      "connections.manage",
      "company.configure",
    ])
      result.add(value);
  if (roles.includes("director")) result.add("leadership.transfer");
  return [...result].sort();
}
const sessionRoles: Record<"director" | "deputy" | "driver", Role[]> = {
  director: ["director", "driver"],
  deputy: ["deputy_director", "driver"],
  driver: ["driver"],
};
const members: S["MemberSummary"][] = [
  {
    id: ids.volga,
    nickname: names.volga,
    formerMember: false,
    roles: ["deputy_director", "driver"],
  },
  {
    id: ids.kestrel,
    nickname: names.kestrel,
    formerMember: false,
    roles: ["dispatcher", "driver"],
  },
  { id: ids.cedar, nickname: names.cedar, formerMember: false, roles: ["driver"] },
];

export type Command = {
  method: string;
  path: string;
  body: string | null;
  key: string | undefined;
  ifMatch: string | undefined;
  csrf: string | undefined;
  contentType: string | undefined;
};
/** A queued outcome for the next command: a status, a 429 wait, or a dropped connection. */
export type Outcome = number | "abort" | { status: 429; retryAfter: number };
export type SettingsOptions = {
  role?: "director" | "deputy" | "driver";
  emailVerified?: boolean;
  omitCapabilities?: string[];
  delegateQualifications?: boolean;
  reportingTimezone?: string | null;
  missingSetup?: string[];
  /** Starts with a usable code for Volga Ray. */
  pending?: boolean;
  /** Seconds until a new code may be requested, from the start. */
  resendIn?: number;
  displayTimezone?: string;
  /** Page clock origin when the test installs `page.clock`; server times follow it. */
  base?: number;
};
/**
 * Synthetic company settings and leadership API with fictional members. Every command is recorded;
 * any route outside this list is recorded as unexpected and fails with a placeholder body.
 */
export async function mockSettings(page: Page, options: SettingsOptions = {}) {
  const started = Date.now(),
    clock = () => (options.base ?? started) + (Date.now() - started);
  const timezone = options.reportingTimezone === undefined ? null : options.reportingTimezone;
  const state = {
    role: options.role ?? "director",
    emailVerified: options.emailVerified ?? true,
    transferred: false,
    transferResponseGate: null as Promise<void> | null,
    selfReadsAfterTransfer: 0,
    selfReplacementAfterTransfer: null as S["MemberSummary"] | null,
    selfResponseGateAfterTransfer: null as Promise<void> | null,
    auditDeniedAfterTransfer: 0,
    settings: {
      id: ids.company,
      version: 1,
      launchReady: false,
      reportingTimezone: timezone,
      missingSetup:
        options.missingSetup ??
        (timezone
          ? ["qualification_configuration"]
          : ["company_reporting_timezone", "qualification_configuration"]),
    } as S["CompanySettings"],
    settingsStatus: 200,
    sourcesStatus: 200,
    auditStatus: 200,
    auditEmpty: false,
    auditTotal: undefined as number | undefined,
    auditPageSize: 25,
    auditCursorStatus: 200,
    membersStatus: 200,
    membersEmpty: false,
    challengeStatus: 200,
    pending: null as S["PendingLeadershipChallenge"] | null,
    resendAvailableAt:
      options.resendIn === undefined ? null : iso(clock() + options.resendIn * 1000),
    outcomes: [] as Outcome[],
    commands: [] as Command[],
    reads: [] as string[],
    unexpected: [] as string[],
  };
  const challenge = (successor: S["MemberSummary"], id: string = ids.challenge) => ({
    id,
    successor,
    expiresAt: iso(clock() + 600_000),
    attemptsRemaining: 5,
  });
  if (options.pending) state.pending = challenge(members[0] as S["MemberSummary"]);
  const self = () => {
    const value = accountFixture();
    const roles = state.transferred ? sessionRoles.driver : sessionRoles[state.role];
    value.data.member.roles = roles;
    value.data.emailVerified = state.emailVerified;
    value.data.capabilities = capabilities(roles).filter(
      (capability) => !options.omitCapabilities?.includes(capability),
    );
    value.data.preferences.displayTimezone = options.displayTimezone ?? "Europe/Berlin";
    const replacement = state.transferred && state.selfReplacementAfterTransfer;
    if (replacement) {
      value.data.member = replacement;
      value.data.capabilities = capabilities(replacement.roles);
    }
    return value;
  };
  await page.route("**/api/v1/**", async (route: Route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", ""),
      method = request.method();
    if (options.delegateQualifications && path.includes("qualification")) return route.fallback();
    if (path === "/me") {
      if (state.transferred) {
        state.selfReadsAfterTransfer++;
        await state.selfResponseGateAfterTransfer;
      }
      return route.fulfill({ json: self(), headers: { ETag: '"me-1"' } });
    }
    if (path === "/auth/csrf")
      return route.fulfill({ json: envelope({ token: "NONFUNCTIONAL_FIXTURE" }) });
    if (method === "GET") state.reads.push(`${path}${url.search}`);
    if (path === "/admin/company-settings") {
      if (method === "GET") {
        if (state.settingsStatus !== 200) return route.fulfill(failure(state.settingsStatus));
        return route.fulfill({
          json: envelope(state.settings),
          headers: { ETag: `"v${state.settings.version}"` },
        });
      }
      if (method === "PATCH") {
        const outcome = record(route);
        if (outcome) return outcome;
        const body = JSON.parse(request.postData() ?? "{}") as { reportingTimezone: string };
        state.settings = {
          ...state.settings,
          version: state.settings.version + 1,
          reportingTimezone: body.reportingTimezone,
          missingSetup: state.settings.missingSetup.filter(
            (code) => code !== "company_reporting_timezone",
          ),
        };
        return route.fulfill({
          json: envelope(state.settings),
          headers: { ETag: `"v${state.settings.version}"` },
        });
      }
    }
    if (method === "GET" && path === "/admin/source-capabilities") {
      if (state.sourcesStatus !== 200) return route.fulfill(failure(state.sourcesStatus));
      return route.fulfill({
        json: envelope({
          sources: (["ets2telemetry", "manual", "trucky", "vtcbase"] as const).map((provider) => ({
            provider,
            implemented: provider === "ets2telemetry" || provider === "manual",
            runtimeEnabled: provider !== "vtcbase",
            ownership: provider === "trucky" || provider === "vtcbase" ? "company" : "personal",
          })),
          telemetry: true,
          manual: true,
          qualifications: true,
          externalIdentities: true,
          admissions: true,
          mail: true,
        }),
      });
    }
    if (method === "GET" && path === "/admin/audit") {
      if (state.transferred) {
        state.auditDeniedAfterTransfer++;
        return route.fulfill(failure(403));
      }
      if (state.auditStatus !== 200) return route.fulfill(failure(state.auditStatus));
      const view = url.searchParams.get("view"),
        action = url.searchParams.get("action"),
        cursor = url.searchParams.get("cursor"),
        limit = url.searchParams.get("limit");
      if (view !== "stage3" || limit !== "25") return route.fulfill(failure(422));
      if (cursor && cursor !== "synthetic+second/page=") return route.fulfill(failure(409));
      if (cursor && state.auditCursorStatus !== 200)
        return route.fulfill(failure(state.auditCursorStatus));
      const base = {
        actorId: ids.self,
        actorNickname: "Fictional Director",
        subjectId: ids.company,
      };
      const entries: S["AuditStage3Entry"][] = [
        {
          ...base,
          id: "d6500000-0000-4000-8000-000000000001",
          action: "configuration.changed",
          objectType: "company",
          objectName: "Yukon Union",
          occurredAt: "2026-10-31T16:02:00.000Z",
          details: {
            before: { reportingTimezone: null },
            after: { reportingTimezone: "America/Edmonton" },
          },
        },
        {
          ...base,
          id: "d6500000-0000-4000-8000-000000000002",
          action: "membership.changed",
          objectType: "user",
          objectName: names.cedar,
          subjectId: ids.cedar,
          occurredAt: "2026-10-30T08:05:00.000Z",
          details: {
            before: { status: "active", role: "trainee" },
            after: { status: "active", role: "driver" },
          },
        },
        {
          ...base,
          id: "d6500000-0000-4000-8000-000000000003",
          action: "configuration.changed",
          actorNickname: null,
          objectType: "company",
          objectName: null,
          occurredAt: "2026-10-28T12:10:00.000Z",
          details: null,
        },
        {
          ...base,
          id: "d6500000-0000-4000-8000-000000000004",
          action: "catalog.published",
          actorId: null,
          actorNickname: null,
          objectType: "catalog",
          objectName: "Fictional catalog",
          occurredAt: "2026-10-02T17:30:00.000Z",
          details: null,
        },
        {
          ...base,
          id: "d6500000-0000-4000-8000-000000000005",
          action: "synthetic.unregistered",
          objectType: "application",
          objectName: null,
          occurredAt: "2026-09-01T16:00:00.000Z",
          details: null,
        },
      ];
      const filtered = state.auditEmpty
        ? []
        : entries.filter((row) => !action || row.action === action);
      const offset = cursor ? state.auditPageSize : 0;
      return route.fulfill({
        json: envelope({
          items: filtered.slice(offset, offset + state.auditPageSize),
          nextCursor:
            offset + state.auditPageSize < filtered.length ? "synthetic+second/page=" : null,
          ...(state.auditTotal === undefined ? {} : { total: state.auditTotal }),
        }),
      });
    }
    if (method === "GET" && path === "/admin/members") {
      if (state.membersStatus !== 200) return route.fulfill(failure(state.membersStatus));
      const selfSummary = self().data.member;
      const rows = state.membersEmpty ? [selfSummary] : [selfSummary, ...members];
      return route.fulfill({
        json: envelope({
          items: rows.map((member) => ({
            accessEpoch: 1,
            email: `${member.id}@example.invalid`,
            identityEpoch: 1,
            lastAcceptedTripAt: null,
            profile: { member, qualifications: [] },
            status: "active",
            version: 1,
          })),
          nextCursor: null,
        }),
      });
    }
    if (method === "GET" && path === "/admin/leadership/challenge") {
      if (state.challengeStatus !== 200) return route.fulfill(failure(state.challengeStatus));
      const pending =
        state.pending && Date.parse(state.pending.expiresAt) > clock() ? state.pending : null;
      const resend =
        state.resendAvailableAt && Date.parse(state.resendAvailableAt) > clock()
          ? state.resendAvailableAt
          : null;
      return route.fulfill({ json: envelope({ pending, resendAvailableAt: resend }) });
    }
    if (method === "POST" && path === "/admin/leadership/challenges") {
      const outcome = record(route);
      if (outcome) return outcome;
      const body = JSON.parse(request.postData() ?? "{}") as { successorId: string };
      const successor = members.find((member) => member.id === body.successorId);
      if (!successor) return route.fulfill(failure(409));
      const id = `b6500000-0000-4000-8000-${String(state.commands.length).padStart(12, "0")}`;
      state.pending = challenge(successor, id);
      state.resendAvailableAt = iso(clock() + 60_000);
      return route.fulfill({
        status: 202,
        json: envelope({ id, expiresAt: state.pending.expiresAt, state: "sent" }),
      });
    }
    if (method === "POST" && path === "/admin/leadership/transfers") {
      const outcome = record(route);
      if (outcome) return outcome;
      const body = JSON.parse(request.postData() ?? "{}") as { challengeId: string; code: string };
      if (!state.pending || body.challengeId !== state.pending.id)
        return route.fulfill(failure(401));
      if (body.code !== correctCode) {
        const left = state.pending.attemptsRemaining - 1;
        state.pending = left > 0 ? { ...state.pending, attemptsRemaining: left } : null;
        return route.fulfill(failure(401));
      }
      state.pending = null;
      state.transferred = true;
      await state.transferResponseGate;
      return route.fulfill({ json: envelope({ id: ids.company, version: 2 }) });
    }
    state.unexpected.push(`${method} ${path}`);
    return route.fulfill(failure(503));
  });
  /** Records the command; returns a fulfilled outcome when one is queued for this attempt. */
  function record(route: Route) {
    const request = route.request(),
      headers = request.headers();
    state.commands.push({
      method: request.method(),
      path: new URL(request.url()).pathname.replace("/api/v1", ""),
      body: request.postData(),
      key: headers["idempotency-key"],
      ifMatch: headers["if-match"],
      csrf: headers["x-csrf-token"],
      contentType: headers["content-type"],
    });
    const outcome = state.outcomes.shift();
    if (outcome === undefined) return undefined;
    if (outcome === "abort") return route.abort("failed");
    if (typeof outcome === "number") return route.fulfill(failure(outcome));
    return route.fulfill(failure(429, { "Retry-After": String(outcome.retryAfter) }));
  }
  return state;
}
