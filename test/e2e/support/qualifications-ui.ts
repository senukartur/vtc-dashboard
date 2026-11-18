import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];
type Game = S["Game"];
// Fictional in-memory ETS2 ladder and a one-level ATS ladder answering the nine qualification
// routes like the API.
export const qid = (n: number) => `41570000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const driverId = qid(901);
const open: S["QualificationLimits"] = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", types: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
type Row = {
  id: string;
  name: string;
  version: number;
  limits: S["QualificationLimits"];
  conditions: S["QualificationConditions"];
  drivers: S["QualificationLevelDriver"][];
};
export type QualificationRequest = { method: string; path: string; body: unknown };
const envelope = (data: unknown) => ({ data, meta: { requestId: "fictional-request" } });

export async function mockQualifications(
  page: Page,
  options: { lead: boolean; locale?: "en" | "ru"; qualifiedTop?: boolean },
) {
  const requests: QualificationRequest[] = [];
  let next = 100;
  const ladder: Row[] = [
    {
      id: qid(1),
      name: "Fictional Trainee",
      version: 1,
      limits: { ...open, massMaxKg: "20000", adr: { mode: "forbidden", classes: [] } },
      conditions: { requiredTrips: 5, requiredDistanceM: "500000" },
      drivers: [
        {
          memberId: driverId,
          displayName: "Fictional_Driver",
          since: "2026-11-01T10:00:00.000Z",
          credited: { trips: 2, distanceM: "180000" },
        },
      ],
    },
    {
      id: qid(2),
      name: "Fictional Driver",
      version: 1,
      limits: { ...open, hardModeRequired: true },
      // With qualifiedTop the top has conditions that one of its drivers already meets, so a
      // level placed above it would promote that driver at once.
      conditions: options.qualifiedTop
        ? { requiredTrips: 3, requiredDistanceM: null }
        : { requiredTrips: null, requiredDistanceM: null },
      drivers: options.qualifiedTop
        ? [
            {
              memberId: qid(902),
              displayName: "Fictional_Veteran",
              since: "2026-10-01T10:00:00.000Z",
              credited: { trips: 4, distanceM: "900000" },
            },
          ]
        : [],
    },
  ];
  const ats: Row[] = [
    {
      id: qid(3),
      name: "Fictional Hauler",
      version: 1,
      limits: open,
      conditions: { requiredTrips: null, requiredDistanceM: null },
      drivers: [],
    },
  ];
  const ref = (row: Row) => ({ id: row.id, name: row.name });
  const mine = (): S["MyQualification"] | null => {
    const index = ladder.findIndex((row) => row.drivers.some((d) => d.memberId === driverId));
    const row = ladder[index];
    if (!row) return null;
    const after = ladder[index + 1];
    return {
      game: "ets2",
      level: { id: row.id, name: row.name, position: index + 1 },
      since: "2026-11-01T10:00:00.000Z",
      progress: { trips: 2, distanceM: "180000" },
      conditions: after ? row.conditions : null,
      nextLevel: after ? ref(after) : null,
    };
  };
  const summary = (row: Row, index: number, list = ladder): S["QualificationLevelSummary"] => {
    const after = list[index + 1];
    return {
      id: row.id,
      game: list === ats ? "ats" : "ets2",
      name: row.name,
      position: index + 1,
      version: row.version,
      limits: row.limits,
      conditions: row.conditions,
      nextLevel: after ? ref(after) : null,
      driverCount: row.drivers.length,
    };
  };
  const detail = (row: Row): S["QualificationLevelDetail"] => ({
    ...summary(row, ladder.indexOf(row)),
    levelCount: ladder.length,
    canManage: options.lead,
    mine: mine(),
    drivers: row.drivers,
    history: options.lead ? [] : null,
  });
  const limits = (input: S["QualificationLimitsInput"]): S["QualificationLimits"] => ({
    ...input,
    trailers: {
      ...(input.trailers.basis ? { basis: input.trailers.basis } : {}),
      mode: input.trailers.mode,
      types: [],
    },
  });
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.slice("/api/v1".length),
      method = request.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/me") {
      const self = accountFixture(options.locale);
      if (options.lead) {
        self.data.member.roles = ["deputy_director"];
        self.data.capabilities.push("qualifications.manage");
      }
      return json(self);
    }
    if (path === "/auth/csrf") return json(envelope({ token: "NONFUNCTIONAL_FIXTURE" }));
    // The shell's upcoming-event chip reads this on every page; no event is scheduled.
    if (path === "/me/upcoming-event") return json(envelope(null));
    if (!path.includes("qualification")) return json({ error: { code: "NOT_FOUND" } }, 404);
    const body = method === "GET" ? null : request.postDataJSON();
    requests.push({ method, path: path + url.search, body });
    const game = (url.searchParams.get("game") ?? "ets2") as Game;
    if (method === "GET" && path === "/qualification-levels")
      return json(
        envelope({
          game,
          canManage: options.lead,
          levels: (game === "ets2" ? ladder : ats).map((row, index, list) =>
            summary(row, index, list),
          ),
          mine: game === "ets2" ? mine() : null,
        }),
      );
    if (method === "GET" && path === "/me/qualifications")
      return json(envelope({ items: [mine()].filter(Boolean) }));
    const level = path.match(/^\/(?:admin\/)?qualification-levels\/([^/]+)(\/[a-z]+)?$/);
    const row = ladder.find((item) => item.id === level?.[1]);
    if (method === "GET" && row && !level?.[2]) return json(envelope(detail(row)));
    if (!options.lead) return json({ error: { code: "FORBIDDEN" } }, 403);
    if (method === "POST" && path === "/admin/qualification-levels") {
      const input = body as S["QualificationLevelCreateInput"];
      const created: Row = {
        id: qid(next++),
        name: input.name,
        version: 1,
        limits: limits(input.limits),
        conditions: input.conditions,
        drivers: [],
      };
      ladder.splice(input.position - 1, 0, created);
      return json(envelope({ level: detail(created), promotedCount: 0 }), 201);
    }
    if (!row) return json({ error: { code: "NOT_FOUND" } }, 404);
    if (method === "PUT" && !level?.[2]) {
      const input = body as S["QualificationLevelUpdateInput"];
      Object.assign(row, {
        name: input.name,
        limits: limits(input.limits),
        conditions: input.conditions,
        version: row.version + 1,
      });
      return json(envelope({ level: detail(row), promotedCount: 0 }));
    }
    if (method === "PUT" && level?.[2] === "/position") {
      const input = body as S["QualificationLevelMoveInput"];
      ladder.splice(ladder.indexOf(row), 1);
      ladder.splice(input.position - 1, 0, row);
      row.version += 1;
      return json(envelope({ level: detail(row), promotedCount: 0 }));
    }
    if (method === "POST" && level?.[2] === "/removal") {
      const input = body as S["QualificationLevelRemovalInput"];
      const target = ladder.find((item) => item.id === input.transferLevelId);
      if (!target) return json({ error: { code: "INVALID" } }, 422);
      target.drivers.push(...row.drivers);
      ladder.splice(ladder.indexOf(row), 1);
      return json(envelope({ transferLevel: detail(target), promotedCount: 0 }));
    }
    return json({ error: { code: "NOT_FOUND" } }, 404);
  });
  // A manual change moves the fictional driver; it is routed separately to keep the pattern exact.
  await page.route("**/api/v1/admin/members/*/qualifications/*", async (route) => {
    const request = route.request(),
      body = request.postDataJSON() as S["QualificationManualChangeInput"];
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname.slice("/api/v1".length),
      body,
    });
    const from = ladder.find((row) => row.drivers.some((d) => d.memberId === driverId)),
      to = ladder.find((row) => row.id === body.levelId);
    if (!from || !to) return route.fulfill({ status: 422, json: { error: { code: "INVALID" } } });
    to.drivers.push(...from.drivers.splice(0));
    return route.fulfill({ json: envelope({ qualification: mine() }) });
  });
  return { requests, ladder };
}
