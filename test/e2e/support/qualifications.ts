import type { Page } from "@playwright/test";
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
  };
  const receipts = new Map<string, unknown>();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      game = url.searchParams.get("game") === "ats" ? "ats" : "ets2";
    if (path.startsWith("/api/v1/catalogs/")) return route.fallback();
    if (path === "/api/v1/me") {
      const self = accountFixture(locale);
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
      return route.fulfill({
        headers: { ETag: `"v${state.memberVersion}"` },
        json: envelope({
          assignment: {
            id: assignmentId,
            periodId: assignmentId,
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
      state.memberVersion++;
      if (path.endsWith("/promotions")) {
        state.currentRank = 1;
        state.eligible = false;
      }
      const result = envelope({
        id: assignmentId,
        periodId: assignmentId,
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
    if (path.endsWith("/qualification-assignments"))
      return route.fulfill({
        headers: { ETag: `"v${state.memberVersion}"` },
        json: list([
          {
            id: assignmentId,
            periodId: assignmentId,
            levelId: levels(game)[0]?.id,
            game,
            assignedAt: "2026-10-20T12:00:00.000Z",
            endedAt: null,
          },
        ]),
      });
    if (path === "/api/v1/qualification-levels")
      return route.fulfill({
        json: list(levels(game).map((l) => ({ ...l, version: state.version }))),
      });
    if (path.startsWith("/api/v1/qualification-levels/")) {
      const levelId = path.split("/")[4],
        rule = {
          id: ruleId,
          levelId,
          game: "ets2",
          publishedAt: "2026-10-20T12:00:00.000Z",
          effectiveAt: "2026-10-20T12:00:00.000Z",
          rules: [{ type: "max_mass", maxKg: "10" }],
          requiredTrips: 2,
          requiredDistanceM: "100",
        };
      return route.fulfill({
        json: path.endsWith("/rule-versions")
          ? list([
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
            ])
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
      const key = request.headers()["idempotency-key"] ?? "";
      state.keys.push(key);
      state.etags.push(request.headers()["if-match"] ?? "");
      if (receipts.has(key)) return route.fulfill({ status: 201, json: receipts.get(key) });
      if (state.uncertain) {
        state.uncertain = false;
        state.version++;
        receipts.set(key, envelope({ ...levels("ets2")[0], version: state.version }));
        return route.abort("failed");
      }
      if (state.publishStatus !== 201)
        return route.fulfill({
          status: state.publishStatus,
          headers: state.publishStatus === 429 ? { "Retry-After": "2" } : {},
          json: {},
        });
      state.version++;
      return route.fulfill({
        status: 201,
        json: envelope({ ...levels("ets2")[0], version: state.version }),
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}
