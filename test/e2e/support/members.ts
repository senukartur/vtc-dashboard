import type { Page, Route } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];
type Role = S["MemberSummary"]["roles"][number];
export const ids = {
  director: "a6400000-0000-4000-8000-000000000001",
  deputy: "a6400000-0000-4000-8000-000000000002",
  kestrel: "a6400000-0000-4000-8000-000000000003",
  trainee: "a6400000-0000-4000-8000-000000000004",
  long: "a6400000-0000-4000-8000-000000000005",
  former: "a6400000-0000-4000-8000-000000000006",
  proof: "b6400000-0000-4000-8000-000000000001",
  viewer: "a6400000-0000-4000-8000-000000000099",
} as const;
export const names = {
  director: "Fictional Aurora Dawn",
  deputy: "Fictional Volga Ray",
  kestrel: "Fictional Kestrel",
  trainee: "Fictional Frost Bite",
  long: "Вымышленный Северный Караванщик Долгой Дороги",
  former: "Fictional Old Ford",
  /** Shared by every `repeatedNicknames` member, like the reused account fixture nickname. */
  repeated: "Fictional Account Member",
} as const;
/** Error bodies carry this placeholder; it must never render. */
export const sentinel = "PRIVATE_SENTINEL";
export const levelId = (game: "ets2" | "ats", code: string) =>
  `c6400000-0000-4000-8000-0000000${game === "ets2" ? "1" : "2"}${
    { trainee: "0001", driver_iii: "0003", driver_ii: "0002", driver_i: "0004" }[code] ?? "0000"
  }`;
const codes = ["trainee", "driver_iii", "driver_ii", "driver_i"] as const;
const levelNames = {
  trainee: "Trainee",
  driver_iii: "Driver III",
  driver_ii: "Driver II",
  driver_i: "Driver I",
} as const;
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-members" } });
const failure = (status: number) => ({
  status,
  json: {
    error: { code: sentinel, messageKey: "errors.synthetic", retryable: false },
    meta: { requestId: "synthetic-members" },
  },
});
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();

function member(
  id: string,
  nickname: string,
  roles: Role[],
  levels: Partial<Record<"ets2" | "ats", (typeof codes)[number]>>,
  lastAcceptedTripAt: string | null,
  status: "active" | "inactive" = "active",
): S["MemberAdmin"] {
  return {
    accessEpoch: 1,
    email: `${id}@example.invalid`,
    identityEpoch: 1,
    lastAcceptedTripAt,
    profile: {
      member: { id, nickname, formerMember: status === "inactive", roles },
      qualifications: (["ets2", "ats"] as const)
        .filter((game) => levels[game])
        .map((game, index) => ({
          id: `d6400000-0000-4000-8000-0000000${id.slice(-3)}0${index}`,
          game,
          levelId: levelId(game, levels[game] ?? "trainee"),
          periodId: `e6400000-0000-4000-8000-0000000${id.slice(-3)}0${index}`,
          assignedAt: "2026-03-14T10:00:00.000Z",
        })),
    },
    status,
    version: 1,
  };
}
export type Command = {
  method: string;
  path: string;
  body: string | null;
  key: string | undefined;
  ifMatch: string | undefined;
  csrf: string | undefined;
  contentType: string | undefined;
};
export type MembersOptions = {
  session?: "deputy" | "director";
  capabilities?: string[];
  displayTimezone?: string;
  pageSize?: number;
  /** Members sharing `names.repeated`, listed between the deputy and Fictional Kestrel. */
  repeatedNicknames?: number;
  statusCounts?: S["AdminMemberStatusCounts"];
};
/**
 * Synthetic members API: a deputy (or the serving director) session with members.manage, six
 * fictional members, one verified Steam proof and the eight level options. Every read and command
 * is recorded; anything unexpected answers 503 with a sentinel that must never render.
 */
export async function mockMembers(page: Page, options: MembersOptions = {}) {
  const session = options.session ?? "deputy";
  const state = {
    members: [
      member(
        ids.director,
        names.director,
        ["director", "driver"],
        { ets2: "driver_i", ats: "driver_ii" },
        "2026-10-31T18:20:00.000Z",
      ),
      member(
        ids.deputy,
        names.deputy,
        ["deputy_director", "dispatcher", "driver"],
        { ets2: "driver_i" },
        "2026-10-30T09:00:00.000Z",
      ),
      member(
        ids.kestrel,
        names.kestrel,
        ["dispatcher", "driver"],
        { ets2: "driver_iii", ats: "trainee" },
        "2026-10-31T23:30:00.000Z",
      ),
      member(ids.trainee, names.trainee, ["trainee"], { ets2: "trainee" }, null),
      member(
        ids.long,
        names.long,
        ["driver"],
        { ets2: "driver_ii", ats: "driver_ii" },
        "2026-10-22T12:00:00.000Z",
      ),
      member(ids.former, names.former, [], {}, "2026-06-28T12:00:00.000Z", "inactive"),
    ],
    proofs: [
      {
        id: ids.proof,
        memberId: ids.kestrel,
        candidateSteamProfileUrl: "https://steamcommunity.com/id/fictional-kestrel-replacement",
        createdAt: iso(Date.now() - 3_600_000),
        verifiedAt: iso(Date.now() - 3_000_000),
        expiresAt: iso(Date.now() + 86_400_000),
        identityEpoch: 1,
        state: "verified",
      } satisfies S["SteamReplacementProof"],
    ],
    listStatus: 200,
    listGate: null as Promise<void> | null,
    detailStatus: 200,
    optionsStatus: 200,
    pageSize: options.pageSize ?? 100,
    commandOutcomes: [] as (number | "abort")[],
    commands: [] as Command[],
    reads: [] as string[],
  };
  state.members.splice(
    2,
    0,
    ...Array.from({ length: options.repeatedNicknames ?? 0 }, (_, index) =>
      member(
        `a6400000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
        names.repeated,
        ["driver"],
        { ets2: "trainee" },
        null,
      ),
    ),
  );
  const find = (id: string) => state.members.find((row) => row.profile.member.id === id);
  const etag = (row: S["MemberAdmin"]) => ({ ETag: `"m-${row.version}"` });
  await page.route("**/api/v1/**", async (route: Route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", ""),
      method = request.method();
    if (path === "/me") {
      const self = accountFixture();
      if (session === "director") {
        self.data.member = {
          id: ids.director,
          nickname: names.director,
          formerMember: false,
          roles: ["director", "driver"],
        };
        self.data.emailVerified = true;
      } else self.data.member.roles = ["deputy_director", "driver"];
      self.data.preferences.displayTimezone = options.displayTimezone ?? "UTC";
      self.data.capabilities = (options.capabilities ?? [
        ...self.data.capabilities,
        "applications.manage",
        "members.manage",
        "company.configure",
        ...(session === "director" ? ["leadership.transfer"] : []),
      ]) as typeof self.data.capabilities;
      return route.fulfill({ json: self, headers: { ETag: '"v1"' } });
    }
    if (path === "/auth/csrf")
      return route.fulfill({ json: envelope({ token: "NONFUNCTIONAL_FIXTURE" }) });
    if (method === "GET") state.reads.push(`${path}${url.search}`);
    if (method === "GET" && path === "/admin/members") {
      if (state.listGate) await state.listGate;
      if (state.listStatus !== 200) return route.fulfill(failure(state.listStatus));
      const status = url.searchParams.get("status") ?? "active",
        role = url.searchParams.get("role"),
        search = url.searchParams.get("search")?.trim().toLowerCase(),
        start = Number(url.searchParams.get("cursor") ?? 0);
      const rows = state.members.filter(
        (row) =>
          row.status === status &&
          (!role || row.profile.member.roles.includes(role as Role)) &&
          (!search || row.profile.member.nickname.toLowerCase().includes(search)),
      );
      const items = rows.slice(start, start + state.pageSize);
      return route.fulfill({
        json: envelope({
          items,
          nextCursor: start + state.pageSize < rows.length ? String(start + state.pageSize) : null,
          ...(options.statusCounts ? { statusCounts: options.statusCounts } : {}),
        }),
      });
    }
    if (method === "GET" && path === "/admin/reinstatement-options") {
      if (state.optionsStatus !== 200) return route.fulfill(failure(state.optionsStatus));
      return route.fulfill({
        json: envelope({
          levels: (["ets2", "ats"] as const).flatMap((game) =>
            codes.map((code) => ({ id: levelId(game, code), game, code, name: levelNames[code] })),
          ),
        }),
      });
    }
    const detail =
      /^\/admin\/members\/([^/]+)(\/identity|\/steam-replacement-verifications|\/membership|\/roles|\/deactivation|\/reinstatement|\/steam-replacement)?$/.exec(
        path,
      );
    const row = detail?.[1] ? find(detail[1]) : undefined;
    if (detail && row) {
      const suffix = detail[2];
      if (method === "GET" && !suffix) {
        if (state.detailStatus !== 200) return route.fulfill(failure(state.detailStatus));
        return route.fulfill({ json: envelope(row), headers: etag(row) });
      }
      if (method === "GET" && suffix === "/identity")
        return route.fulfill({
          json: envelope({
            identityEpoch: row.identityEpoch,
            pendingReplacementId: null,
            steamProfileUrl: `https://steamcommunity.com/id/fictional-${row.profile.member.id.slice(-4)}`,
            steamStatus: "verified",
            truckersMp: {
              checkedAt: "2026-10-30T08:00:00.000Z",
              displayName: null,
              failure: null,
              found: true,
              lastAttemptAt: "2026-10-30T08:00:00.000Z",
              playerId: null,
              status: "available",
              vtc: null,
            },
          } satisfies S["Identity"]),
        });
      if (method === "GET" && suffix === "/steam-replacement-verifications")
        return route.fulfill({
          json: envelope({
            items: state.proofs.filter((proof) => proof.memberId === row.profile.member.id),
            nextCursor: null,
          }),
        });
      if (method !== "GET" && suffix) {
        const outcome = record(route);
        if (outcome) return outcome;
        const body = JSON.parse(request.postData() ?? "{}") as {
          membership?: "trainee" | "driver";
          roles?: Role[];
          verificationId?: string;
        };
        const current = row.profile.member;
        if (suffix === "/membership" && body.membership)
          current.roles = [
            ...current.roles.filter((role) => role !== "trainee" && role !== "driver"),
            body.membership,
          ];
        if (suffix === "/roles" && body.roles) current.roles = body.roles;
        if (suffix === "/deactivation") {
          row.status = "inactive";
          current.roles = [];
          current.formerMember = true;
        }
        if (suffix === "/reinstatement" && body.roles) {
          row.status = "active";
          current.roles = body.roles;
          current.formerMember = false;
        }
        if (suffix === "/steam-replacement") {
          row.identityEpoch += 1;
          state.proofs = [];
        }
        row.version += 1;
        return route.fulfill({
          json: envelope({ id: current.id, version: row.version }),
          headers: etag(row),
        });
      }
    }
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
    const outcome = state.commandOutcomes.shift();
    if (outcome === "abort") return route.abort("failed");
    if (typeof outcome === "number")
      return route.fulfill({
        status: outcome,
        json: {
          error: { code: "SYNTHETIC_CONFLICT", messageKey: "errors.conflict", retryable: false },
          meta: { requestId: "synthetic-members" },
        },
      });
    return undefined;
  }
  return state;
}
