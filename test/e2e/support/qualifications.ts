import { inertNotifications } from "./notifications.ts";
import type { Page, Route } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { envelope, list, mockCatalogs } from "./catalogs.ts";

type S = components["schemas"];
export const memberId = "d3100000-0000-4000-8000-000000000001",
  assignmentId = "d3200000-0000-4000-8000-000000000001",
  ruleId = "d3300000-0000-4000-8000-000000000001";
export const levels = (game: "ets2" | "ats"): S["QualificationLevel"][] =>
  (["trainee", "driver_iii", "driver_ii", "driver_i"] as const).map((code, i) => ({
    id: `d3400000-0000-4000-8000-00000000000${i + 1}`,
    version: 1,
    game,
    code,
    name: `Fictional ${code}`,
    ruleVersionId: ruleId,
    configured: true,
    requiredTrips: 2,
    requiredDistanceM: "100.000000000000000001",
  }));
export async function mockQualifications(page: Page, locale: "en" | "ru" = "en", staff = true) {
  await mockCatalogs(page, staff);
  const held: { release: () => void; done: Promise<void> }[] = [];
  const state = {
    progressStatus: 200,
    publishStatus: 201,
    uncertain: false,
    version: 1,
    keys: [] as string[],
    etags: [] as string[],
    memberVersion: 7,
    currentRank: 0,
    eligible: true,
    progressGate: null as Promise<void> | null,
    previewInputs: [] as S["QualificationPreviewInput"][],
    progressDelay: 0,
    review: false,
    unset: false,
    emptyHistory: false,
    unconfigured: false,
    selfReads: 0,
    selfPromoted: false,
    rulePaged: false,
    ruleRequests: [] as string[],
    rulePointer: ruleId,
    ruleGate: null as Promise<void> | null,
    renamePointer: null as string | null,
    scheduledPointer: null as string | null,
    publications: [] as S["RulesInput"][],
    deferNext: [] as ("levels" | "progress" | "history")[],
    heldStarted: [] as string[],
    heldFinished: [] as string[],
    distinctAssignment: false,
    immediatePointer: null as string | null,
    ruleMasses: {} as Record<string, string>,
    memberCommandArrived: 0,
    memberCommitGate: null as Promise<void> | null,
    raceEvents: [] as { event: string; kind: string; version: number; atMs: number }[],
    releaseHeld: async () => {
      const pending = held.splice(0);
      for (const item of pending) item.release();
      await Promise.all(pending.map((item) => item.done));
    },
  };
  async function respond(
    kind: "levels" | "progress" | "history",
    route: Route,
    input: Parameters<Route["fulfill"]>[0],
  ) {
    const captured = structuredClone(input),
      index = state.deferNext.indexOf(kind);
    if (index >= 0) {
      state.deferNext.splice(index, 1);
      let release = () => {},
        complete = () => {};
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        done = new Promise<void>((resolve) => {
          complete = resolve;
        });
      held.push({ release, done });
      state.heldStarted.push(kind);
      const capturedVersion = kind === "levels" ? state.version : state.memberVersion;
      state.raceEvents.push({
        event: "read_captured",
        kind,
        version: capturedVersion,
        atMs: Math.round(performance.now()),
      });
      await gate;
      try {
        await route.fulfill(captured);
        const response = await route.request().response();
        await response?.finished();
      } finally {
        state.heldFinished.push(kind);
        state.raceEvents.push({
          event: "read_released",
          kind,
          version: capturedVersion,
          atMs: Math.round(performance.now()),
        });
        complete();
      }
      return;
    }
    return route.fulfill(captured);
  }
  const currentAssignment = () =>
    state.distinctAssignment && state.memberVersion > 7
      ? "d3200000-0000-4000-8000-000000000002"
      : assignmentId;
  const receipts = new Map<string, unknown>();
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      game = url.searchParams.get("game") === "ats" ? "ats" : "ets2";
    if (path.startsWith("/api/v1/catalogs/")) return route.fallback();
    if (path === "/api/v1/me") {
      state.selfReads++;
      const self = accountFixture(locale);
      if (state.selfPromoted) self.data.member.roles = ["driver"];
      if (staff) self.data.capabilities.push("qualifications.manage");
      return route.fulfill({ json: self });
    }
    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: envelope({ token: "synthetic-csrf" }) });
    if (path === "/api/v1/admin/qualification-members")
      return route.fulfill({
        json: list([
          {
            id: memberId,
            nickname: "Fictional Duplicate Name — длинное имя участника",
            formerMember: true,
            roles: ["driver", "dispatcher"],
          },
          {
            id: "d3100000-0000-4000-8000-000000000002",
            nickname: "Fictional Duplicate Name — длинное имя участника",
            formerMember: true,
            roles: ["driver"],
          },
        ]),
      });
    if (path.endsWith("/qualification-progress")) {
      if (state.progressGate) await state.progressGate;
      if (state.progressDelay)
        await new Promise((resolve) => setTimeout(resolve, state.progressDelay));
      if (state.progressStatus !== 200)
        return route.fulfill({
          status: state.progressStatus,
          json:
            state.progressStatus === 409
              ? {
                  ...envelope(null),
                  data: undefined,
                  error: { code: "SETUP_REQUIRED", messageKey: "setup_required", retryable: false },
                }
              : {},
        });
      return respond("progress", route, {
        headers: { ETag: `"v${state.memberVersion}"` },
        json: envelope({
          assignment: {
            id: currentAssignment(),
            periodId: currentAssignment(),
            levelId: levels(game)[state.currentRank]?.id,
            game,
            assignedAt: "2026-10-20T12:00:00.000Z",
          },
          acceptedTrips: 2,
          actualDistanceM: "100.000000000000000001",
          requiredTrips: state.unset ? null : 2,
          requiredDistanceM: state.unset ? null : "100",
          eligibleForConfirmation: !state.unset && state.eligible,
          reviewRequired: state.review,
          computedAt: "2026-10-25T12:00:00.000Z",
          projectionVersion: 99,
          projectionPending: false,
          reviewReasonCodes: state.review ? ["promotion_requirements_no_longer_met"] : [],
        }),
      });
    }
    if (
      (path.endsWith("/qualification-assignments") || path.endsWith("/promotions")) &&
      request.method() === "POST"
    ) {
      const key = request.headers()["idempotency-key"] ?? "";
      state.keys.push(key);
      state.etags.push(request.headers()["if-match"] ?? "");
      if (receipts.has(key)) return route.fulfill({ status: 201, json: receipts.get(key) });
      state.memberCommandArrived++;
      if (state.memberCommitGate) await state.memberCommitGate;
      state.memberVersion++;
      state.raceEvents.push({
        event: "command_committed",
        kind: "member",
        version: state.memberVersion,
        atMs: Math.round(performance.now()),
      });
      if (path.endsWith("/promotions")) {
        if (path.includes(accountFixture(locale).data.member.id)) state.selfPromoted = true;
        state.currentRank = 1;
        state.eligible = false;
      }
      const result = envelope({
        id: currentAssignment(),
        periodId: currentAssignment(),
        levelId: levels(game)[state.currentRank]?.id,
        game,
        assignedAt: "2026-10-20T12:00:00.000Z",
      });
      receipts.set(key, result);
      if (state.uncertain) {
        state.uncertain = false;
        return route.abort("failed");
      }
      return route.fulfill({ status: 201, json: result });
    }
    if (
      path.endsWith("/qualification-assignments") ||
      path.endsWith("/qualification-action-history")
    )
      return respond("history", route, {
        headers: { ETag: `"v${state.memberVersion}"` },
        json: list(
          state.emptyHistory
            ? []
            : [
                {
                  id: currentAssignment(),
                  periodId: currentAssignment(),
                  levelId: levels(game)[state.distinctAssignment ? state.currentRank : 0]?.id,
                  game,
                  assignedAt: "2026-10-20T12:00:00.000Z",
                  endedAt: null,
                  ...(path.endsWith("/qualification-action-history")
                    ? { purpose: "initial", actor: null, promotion: null }
                    : {}),
                },
              ],
        ),
      });
    if (path === "/api/v1/qualification-levels")
      return respond("levels", route, {
        json: list(
          levels(game).map((l) => ({
            ...l,
            version: state.version,
            ruleVersionId: state.rulePointer,
            ...(state.unconfigured
              ? {
                  ruleVersionId: null,
                  configured: false,
                  requiredTrips: null,
                  requiredDistanceM: null,
                }
              : {}),
          })),
        ),
      });
    if (
      path.startsWith("/api/v1/qualification-levels/") ||
      (path.startsWith("/api/v1/admin/qualification-levels/") && request.method() === "GET")
    ) {
      if (!path.endsWith("/rule-versions") && path.endsWith(state.rulePointer) && state.ruleGate)
        await state.ruleGate;
      if (path.includes("/admin/") && path.endsWith("/rule-versions")) {
        state.ruleRequests.push(`${state.version}:${url.searchParams.get("cursor") ?? ""}`);
        if (state.rulePaged && state.version > 1 && url.searchParams.has("cursor"))
          return route.fulfill({
            status: 409,
            json: {
              error: { code: "VERSION_CONFLICT", messageKey: "version_conflict", retryable: false },
              meta: { requestId: "synthetic-rule-cursor" },
            },
          });
      }
      const levelId = path.split("/")[path.includes("/admin/") ? 5 : 4],
        rule = {
          id: path.endsWith("/rule-versions") ? ruleId : path.split("/").at(-1),
          levelId,
          game: "ets2",
          publishedAt: "2026-10-20T12:00:00.000Z",
          effectiveAt: "2026-10-20T12:00:00.000Z",
          rules: [
            { type: "max_mass", maxKg: state.ruleMasses[path.split("/").at(-1) ?? ""] ?? "10" },
          ],
          requiredTrips: 2,
          requiredDistanceM: "100",
          ...(path.includes("/admin/")
            ? { publisher: { id: memberId, nickname: "Fictional current publisher" } }
            : {}),
        };
      return route.fulfill({
        json: path.endsWith("/rule-versions")
          ? list(
              state.rulePaged
                ? url.searchParams.has("cursor")
                  ? [rule]
                  : [
                      {
                        ...rule,
                        id: "d3300000-0000-4000-8000-000000000002",
                        effectiveAt: "2099-01-01T00:00:00.000Z",
                      },
                    ]
                : [
                    {
                      ...rule,
                      id: "d3300000-0000-4000-8000-000000000002",
                      effectiveAt: "2099-01-01T00:00:00.000Z",
                    },
                    rule,
                    {
                      ...rule,
                      id: "d3300000-0000-4000-8000-000000000003",
                      effectiveAt: "2026-01-01T00:00:00.000Z",
                    },
                  ],
              state.rulePaged && !url.searchParams.has("cursor") ? "synthetic-rule-next" : null,
            )
          : envelope(rule),
      });
    }
    if (path === "/api/v1/admin/qualification-rule-previews") {
      const input = request.postDataJSON() as S["QualificationPreviewInput"];
      state.previewInputs.push(input);
      const mass = input.sample.cargoMassKg;
      return route.fulfill({
        json: envelope({
          outcome: mass === null ? "unknown" : mass === "11" ? "fail" : "pass",
          ruleResults: input.rules.map((r) => ({
            ruleType: r.type,
            outcome: mass === null ? "unknown" : mass === "11" ? "fail" : "pass",
            reasonCode:
              mass === null
                ? "rule_mass_unknown"
                : mass === "11"
                  ? "rule_mass_exceeded"
                  : "rule_passed",
          })),
        }),
      });
    }
    if (path.startsWith("/api/v1/admin/qualification-levels/")) {
      if (request.method() === "POST")
        state.publications.push(request.postDataJSON() as S["RulesInput"]);
      const key = request.headers()["idempotency-key"] ?? "";
      state.keys.push(key);
      state.etags.push(request.headers()["if-match"] ?? "");
      if (receipts.has(key)) return route.fulfill({ status: 201, json: receipts.get(key) });
      if (
        request.method() === "POST" &&
        state.immediatePointer &&
        !request.postDataJSON().effectiveAt
      ) {
        state.rulePointer = state.immediatePointer;
        state.ruleMasses[state.rulePointer] =
          request.postDataJSON().rules.find((rule: S["Rule"]) => rule.type === "max_mass")?.maxKg ??
          "10";
      }
      if (request.method() === "PATCH" && state.renamePointer)
        state.rulePointer = state.renamePointer;
      if (
        request.method() === "POST" &&
        state.scheduledPointer &&
        request.postDataJSON().effectiveAt
      )
        state.rulePointer = state.scheduledPointer;
      if (state.uncertain) {
        state.uncertain = false;
        state.version++;
        state.raceEvents.push({
          event: "command_committed",
          kind: "level",
          version: state.version,
          atMs: Math.round(performance.now()),
        });
        receipts.set(
          key,
          envelope({
            ...levels("ets2")[0],
            version: state.version,
            ruleVersionId: state.rulePointer,
          }),
        );
        return route.abort("failed");
      }
      if (state.publishStatus !== 201)
        return route.fulfill({
          status: state.publishStatus,
          headers: state.publishStatus === 429 ? { "Retry-After": "2" } : {},
          json: {},
        });
      state.version++;
      state.raceEvents.push({
        event: "command_committed",
        kind: "level",
        version: state.version,
        atMs: Math.round(performance.now()),
      });
      return route.fulfill({
        status: 201,
        json: envelope({
          ...levels("ets2")[0],
          version: state.version,
          ruleVersionId: state.rulePointer,
        }),
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}
