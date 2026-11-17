import type { Locator, Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { browserSchemaDocument, browserSchemaRef } from "@vtc/contracts/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { application, type Command, ids, type mockApplications, names } from "./applications.ts";

type S = components["schemas"];
export type Check = S["ApplicationStage4TruckersmpCheck"];
export type ApplicationsState = Awaited<ReturnType<typeof mockApplications>>;

/** Fictional TruckersMP identity of the canonical /profiles/ applicant. */
export const player = {
  steamUrl: "https://steamcommunity.com/profiles/76561190000000001",
  id: "900000000000001",
  name: "Fictional Driver",
  profileUrl: "https://truckersmp.com/user/900000000000001",
  vtc: "Fictional Other VTC",
  tag: "FOV",
} as const;
export const checkedAt = "2026-11-10T09:30:00.000Z";
export const attemptAt = "2026-11-10T09:45:00.000Z";

const empty: Check = {
  state: "not_checked",
  notCheckedReason: null,
  found: null,
  playerId: null,
  displayName: null,
  profileUrl: null,
  bans: null,
  vtc: null,
  checkedAt: null,
  lastAttemptAt: null,
  failure: null,
};
/** Check fixtures in the shapes `checkDto` returns for each stored state. */
export const checks = {
  notRequested: (): Check => ({ ...empty, notCheckedReason: "not_requested" }),
  vanity: (): Check => ({ ...empty, notCheckedReason: "steam_vanity_url" }),
  found: (extra: Partial<Check> = {}): Check => ({
    ...empty,
    state: "completed",
    found: true,
    playerId: player.id,
    displayName: player.name,
    profileUrl: player.profileUrl,
    bans: { any: false, count: 0 },
    vtc: { inVtc: true, id: "900001", name: player.vtc, tag: player.tag },
    checkedAt,
    lastAttemptAt: checkedAt,
    ...extra,
  }),
  notFound: (): Check => ({
    ...empty,
    state: "completed",
    found: false,
    checkedAt,
    lastAttemptAt: checkedAt,
  }),
  /** A running check; with a previous result it keeps the stored profile fields. */
  checking: (previous: Check | null = null): Check => ({
    ...(previous ?? empty),
    state: "checking",
    notCheckedReason: null,
    lastAttemptAt: attemptAt,
    failure: null,
  }),
  failed: (failure: NonNullable<Check["failure"]>, previous: Check | null = null): Check => ({
    ...(previous ?? empty),
    state: "failed",
    notCheckedReason: null,
    lastAttemptAt: attemptAt,
    failure,
  }),
};

const ajv = new Ajv2020({ strict: false });
addFormats.default(ajv);
ajv.addSchema(browserSchemaDocument);
/** True when a stubbed body satisfies the generated envelope the browser parses strictly. */
export function validEnvelope(
  name:
    | "EnvelopeApplication"
    | "EnvelopeListAdminApplication"
    | "ApplicationStage4TruckersmpCheckEnvelope",
  body: unknown,
) {
  return ajv.validate(browserSchemaRef(name), body);
}
export const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-checks" } });

/** The submitted applicant gets the canonical /profiles/ link and the given check. */
export function canonicalApplicant(state: ApplicationsState, id: string, check: Check | null) {
  const app = state.apps.find((item) => item.id === id);
  if (!app) throw new Error("APPLICATION_FIXTURE_MISSING");
  app.fields.steamProfileUrl = player.steamUrl;
  if (check) state.checks.set(id, check);
  else state.checks.delete(id);
}

const steamProfile = (n: number) => `https://steamcommunity.com/profiles/7656119000000000${n}`;
/** One fictional submitted applicant per badge group: passed, attention, failed and pending. */
export const badgeChecks = {
  passed: checks.found({ vtc: { inVtc: false, id: null, name: null, tag: null } }),
  attention: checks.found({ bans: { any: true, count: 2 } }),
  failed: checks.failed("timeout", checks.found()),
  pending: checks.checking(),
} as const;
/**
 * Gives the two submitted applicants /profiles/ links and adds two more, so the queue shows one
 * row per badge group in the order of `badgeChecks`.
 */
export function badgeApplicants(state: ApplicationsState) {
  const rows = [
    [ids.submitted, names.submitted, "2026-10-30T09:30:00.000Z", badgeChecks.passed],
    [ids.second, names.second, "2026-10-29T18:05:00.000Z", badgeChecks.attention],
    [ids.third, names.third, "2026-10-29T11:20:00.000Z", badgeChecks.failed],
    [ids.fourth, names.fourth, "2026-10-28T07:45:00.000Z", badgeChecks.pending],
  ] as const;
  rows.forEach(([id, nickname, submittedAt, check], index) => {
    let app = state.apps.find((item) => item.id === id);
    if (!app) {
      app = application(id, nickname, "submitted", { submittedAt });
      state.apps.push(app);
    }
    app.fields.steamProfileUrl = steamProfile(index + 1);
    state.checks.set(id, check);
  });
  return rows.map(([id, nickname]) => ({ id, nickname }));
}

export type RecheckOutcome = { status: number; retryAfter?: string } | "abort";
/**
 * Records every recheck POST with its headers. Queued outcomes answer in order; otherwise the
 * stub stores `next(previous)` (a running check by default) and answers 202 like the API.
 */
export async function mockRechecks(page: Page, state: ApplicationsState) {
  const recorder = {
    commands: [] as Command[],
    outcomes: [] as RecheckOutcome[],
    gate: null as Promise<void> | null,
    next: (previous: Check | undefined): Check =>
      checks.checking(previous?.found === null ? null : (previous ?? null)),
  };
  await page.route("**/api/v1/admin/applications/*/truckersmp-checks", async (route: Route) => {
    const request = route.request(),
      headers = request.headers(),
      path = new URL(request.url()).pathname.replace("/api/v1", "");
    recorder.commands.push({
      method: request.method(),
      path,
      body: request.postData(),
      key: headers["idempotency-key"],
      ifMatch: headers["if-match"],
      csrf: headers["x-csrf-token"],
      contentType: headers["content-type"],
    });
    if (recorder.gate) await recorder.gate;
    const outcome = recorder.outcomes.shift();
    if (outcome === "abort") return route.abort("failed");
    if (outcome)
      return route.fulfill({
        status: outcome.status,
        headers: outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : {},
        json: {
          error: { code: "SYNTHETIC_RECHECK", messageKey: "errors.conflict", retryable: false },
          meta: { requestId: "synthetic-checks" },
        },
      });
    const id = path.split("/")[3] ?? "";
    const result = recorder.next(state.checks.get(id));
    state.checks.set(id, result);
    return route.fulfill({
      status: 202,
      headers: { "Cache-Control": "no-store" },
      json: envelope(result),
    });
  });
  return recorder;
}

// Layout helpers, as in applications-layout.spec.ts.
export async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
/**
 * Words that wrap mid-word; only .applications-break (links, provider text) may. A clipped phone
 * header row has no visible lines to check.
 */
export async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".applications-break")) continue;
      const head = node.parentElement?.closest("thead");
      if (head && head.getBoundingClientRect().height <= 1) continue;
      for (const match of (node.textContent ?? "").matchAll(/[^\s-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(match[0]);
      }
    }
    return broken;
  });
}
