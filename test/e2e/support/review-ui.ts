import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { envelope, list, mockCatalogs } from "./catalogs.ts";
import { example } from "./trip-ui.ts";

// Fictional review fixtures only; every identity, label, reason and image is synthetic.
type S = components["schemas"];
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trip = (n: number) => uuid("47000000", n);
export const reviewIds = {
  over: trip(1),
  resubmission: trip(2),
  own: trip(3),
  late: trip(4),
  telemetry: trip(5),
  missing: trip(9),
} as const;
export type ReviewTrip = Exclude<keyof typeof reviewIds, "missing">;
export const member = accountFixture("en").data.member;
export const catalogRevisionId = uuid("47100000", 1);
const entity = (n: number) => uuid("47200000", n);
export const entities = {
  north: entity(1),
  south: entity(2),
  harbor: entity(3),
  ridge: entity(4),
  transformer: entity(5),
  lowboy: entity(6),
  curtain: entity(7),
  unknown: entity(8),
  mesa: entity(9),
  canyon: entity(10),
  lumber: entity(11),
  flatbed: entity(12),
} as const;
const labels: Record<string, { kind: string; en: string; ru: string; game?: "ats" }> = {
  [entities.north]: { kind: "city", en: "Fictional Northport", ru: "Вымышленный Северопортск" },
  [entities.south]: {
    kind: "city",
    en: "Fictional South Ridge Junction",
    ru: "Вымышленная Южная Гряда",
  },
  [entities.harbor]: { kind: "city", en: "Fictional Harbor", ru: "Вымышленная Гавань" },
  [entities.ridge]: { kind: "city", en: "Fictional Ridge", ru: "Вымышленный Хребет" },
  [entities.transformer]: {
    kind: "cargo",
    en: "Fictional transformer",
    ru: "Вымышленный трансформатор",
  },
  [entities.lowboy]: {
    kind: "trailer_type",
    en: "Fictional lowboy",
    ru: "Вымышленный низкорамный",
  },
  [entities.curtain]: {
    kind: "trailer_type",
    en: "Fictional curtainsider",
    ru: "Вымышленный шторный",
  },
  [entities.mesa]: { kind: "city", en: "Fictional Mesa", ru: "Вымышленная Меса", game: "ats" },
  [entities.canyon]: {
    kind: "city",
    en: "Fictional Canyon",
    ru: "Вымышленный Каньон",
    game: "ats",
  },
  [entities.lumber]: { kind: "cargo", en: "Fictional lumber", ru: "Вымышленный лес", game: "ats" },
  [entities.flatbed]: {
    kind: "trailer_type",
    en: "Fictional flatbed",
    ru: "Вымышленная платформа",
    game: "ats",
  },
};
export const evidence = {
  ready: uuid("47300000", 1),
  gone: uuid("47300000", 2),
  expired: uuid("47300000", 3),
} as const;
export const reviewer = {
  id: uuid("47400000", 1),
  nickname: "Fictional Dispatcher",
  formerMember: false,
  roles: ["dispatcher"],
} as const;
const colleague = (n: number, nickname: string): S["MemberSummary"] => ({
  id: uuid("47500000", n),
  nickname,
  formerMember: false,
  roles: ["driver"],
});
const owners: Record<ReviewTrip, S["MemberSummary"]> = {
  over: colleague(1, "Fictional_NordWind"),
  resubmission: colleague(2, "Fictional Marta"),
  own: member,
  late: colleague(3, "Fictional Kestrel"),
  telemetry: colleague(4, "Fictional Frost"),
};
const label = (id: string, locale: "en" | "ru" = "en"): S["CatalogLabel"] => ({
  entityId: id,
  label: labels[id]?.[locale] ?? "Fictional place",
  requestedLocale: locale,
  renderedLocale: locale,
  englishFallback: false,
  retired: false,
});
const pin = (entityId: string): S["ManualResolvedSelection"] => ({
  status: "resolved",
  entityId,
  catalogRevisionId,
});
const revision = (
  n: number,
  number: number,
  fields: Partial<S["ManualReportFields"]>,
  submittedAt: string,
): S["ManualReportRevision"] => ({
  representation: "extended",
  id: uuid("47600000", n),
  reportId: uuid("47700000", Math.ceil(n / 2)),
  number,
  submittedAt,
  fields: {
    game: "ets2",
    origin: pin(entities.north),
    destination: pin(entities.south),
    cargo: pin(entities.transformer),
    cargoMassKg: "18000",
    trailerType: pin(entities.curtain),
    actualDistanceM: "693000",
    evidenceIds: [evidence.ready],
    eventId: null,
    comment: null,
    ...fields,
  },
});
export const revisions: Record<ReviewTrip, S["ManualReportRevision"][]> = {
  over: [
    revision(
      1,
      1,
      {
        cargoMassKg: "34000",
        trailerType: pin(entities.lowboy),
        evidenceIds: [evidence.ready, evidence.gone, evidence.expired],
        comment: "Was in a convoy without a record.\nSecond fictional line.",
      },
      "2026-10-30T02:15:00.000Z",
    ),
  ],
  resubmission: [
    revision(
      4,
      2,
      {
        origin: pin(entities.harbor),
        destination: pin(entities.ridge),
        cargoMassKg: "12200",
        actualDistanceM: "1018000",
        comment: "Fixed the mass from the screenshot",
      },
      "2026-10-31T09:12:00.000Z",
    ),
    revision(
      3,
      1,
      {
        origin: pin(entities.harbor),
        destination: pin(entities.ridge),
        cargo: pin(entities.unknown),
        cargoMassKg: "21200",
        actualDistanceM: "1108000",
      },
      "2026-10-29T00:31:00.000Z",
    ),
  ],
  own: [
    revision(
      5,
      1,
      { origin: pin(entities.ridge), destination: pin(entities.harbor) },
      "2026-10-31T05:58:00.000Z",
    ),
  ],
  late: [
    revision(
      7,
      1,
      { origin: pin(entities.south), destination: pin(entities.north), cargoMassKg: "21000" },
      "2026-10-20T08:00:00.000Z",
    ),
  ],
  telemetry: [],
};
const evidenceItems: S["Evidence"][] = [
  {
    id: evidence.ready,
    state: "ready",
    contentType: "image/png",
    byteLength: pngBytes().length,
    originalName: "fictional-results-screen.png",
  },
  {
    id: evidence.gone,
    state: "ready",
    contentType: "image/png",
    byteLength: pngBytes().length,
    originalName: "fictional-second-screen.png",
  },
  {
    id: evidence.expired,
    state: "expired",
    contentType: "image/png",
    byteLength: 64,
    originalName: "fictional-old-screen.png",
  },
];
const rule = (
  ruleType: string,
  outcome: "pass" | "fail" | "unknown",
  reasonCode: string,
  extra: Partial<S["QualificationRuleCheck"]> = {},
): S["QualificationRuleCheck"] => ({
  ruleType,
  outcome,
  reasonCode,
  bypassedByEvent: false,
  observedMassKg: null,
  limitMassKg: null,
  entityIds: [],
  ...extra,
});
export const rejection = "Fictional mass on the screenshot\ndiffers from the report";
const decision = (
  n: number,
  outcome: "accepted" | "rejected",
  reason: string,
  decidedAt: string,
  overLimits = false,
): S["Decision"] => {
  const base = example("decideTrip:accepted-over-limits").data as S["Decision"];
  return {
    ...base,
    id: uuid("47800000", n),
    outcome,
    reason,
    decidedAt,
    reviewerId: reviewer.id,
    reviewer: { ...reviewer, roles: ["dispatcher"] },
    acceptedOverLimits: overLimits,
    reasonCodes: overLimits ? ["rule_mass_exceeded", "accepted_over_limits"] : [],
  };
};

export type ReviewState = {
  version: number;
  review: S["Review"];
  summary: S["TripSummary"];
};
function build(key: ReviewTrip, locale: "en" | "ru"): ReviewState {
  const base = example("getTripReview:over-limits").data as S["Review"],
    current = revisions[key][0] ?? null,
    owner = owners[key],
    route = {
      over: [entities.north, entities.south],
      resubmission: [entities.harbor, entities.ridge],
      own: [entities.ridge, entities.harbor],
      late: [entities.south, entities.north],
      telemetry: [entities.mesa, entities.canyon],
    }[key] as [string, string];
  const summary: S["TripSummary"] = {
    ...base.trip.summary,
    id: reviewIds[key],
    owner,
    game: key === "telemetry" ? "ats" : "ets2",
    decision: key === "late" ? "accepted" : "pending_review",
    origin: label(route[0], locale),
    destination: label(route[1], locale),
    cargo: label(key === "telemetry" ? entities.lumber : entities.transformer, locale),
    sourceKinds:
      key === "telemetry"
        ? ["ets2telemetry"]
        : key === "late"
          ? ["ets2telemetry", "manual"]
          : ["manual"],
  };
  const checks: Record<ReviewTrip, S["QualificationCheck"]> = {
    over: {
      status: "resolved",
      reasonCode: null,
      rules: [
        rule("max_mass", "fail", "rule_mass_exceeded", {
          observedMassKg: "34000",
          limitMassKg: "20000",
        }),
        rule("allowed_trailer_types", "fail", "rule_trailer_type_disallowed", {
          entityIds: [entities.lowboy],
        }),
        rule("allowed_adr_categories", "pass", "rule_passed"),
      ],
    },
    resubmission: {
      status: "resolved",
      reasonCode: null,
      rules: [
        rule("max_mass", "pass", "rule_passed", { observedMassKg: "12200", limitMassKg: "25000" }),
        rule("allowed_trailer_types", "pass", "rule_passed", { bypassedByEvent: true }),
      ],
    },
    own: { status: "resolved", reasonCode: null, rules: [rule("max_mass", "pass", "rule_passed")] },
    late: {
      status: "resolved",
      reasonCode: null,
      rules: [
        rule("max_mass", "fail", "rule_mass_exceeded", {
          observedMassKg: "21000",
          limitMassKg: "20000",
        }),
      ],
    },
    telemetry: {
      status: "unresolved",
      reasonCode: "qualification_history_unknown",
      rules: [],
    },
  };
  // Stored hold reasons of the trip itself; the telemetry trip also has an unlabeled code.
  const holds: Record<ReviewTrip, string[]> = {
    over: ["rule_mass_exceeded", "rule_trailer_type_disallowed"],
    resubmission: [],
    own: [],
    late: ["confirmed_facts_require_review"],
    telemetry: ["qualification_history_unknown", "clock_anomaly", "fictional_unlabeled_hold"],
  };
  const effective = (
    pins: [string, string, string, string],
    values: Partial<S["EffectiveTripFacts"]>,
  ): S["EffectiveTripFacts"] => {
    const factRevisionId = uuid("47900000", Object.keys(reviewIds).indexOf(key) + 1),
      at = (entityId: string) => ({ entityId, catalogRevisionId, factRevisionId });
    return {
      factRevisionId,
      provider: "ets2telemetry",
      actualStartAt: "2026-10-28T13:05:00.000Z",
      actualCompletedAt: "2026-10-28T15:47:00.000Z",
      actualDistanceM: "812400",
      plannedDistanceM: null,
      cargoMassKg: "19500",
      origin: at(pins[0]),
      destination: at(pins[1]),
      cargo: at(pins[2]),
      trailers: [at(pins[3])],
      trailersComplete: true,
      wholeTripDistanceSupported: true,
      ruleContextComplete: true,
      ...values,
    };
  };
  // Telemetry-only facts keep an unknown mass and planned distance unavailable, never zero.
  // The resubmission's manual facts carry a staff-resolved distance that differs from its revision.
  const facts: Partial<Record<ReviewTrip, S["EffectiveTripFacts"]>> = {
    resubmission: effective(
      [entities.harbor, entities.ridge, entities.transformer, entities.curtain],
      {
        provider: "manual",
        actualStartAt: null,
        actualCompletedAt: null,
        actualDistanceM: "1012000",
        cargoMassKg: "12200",
      },
    ),
    telemetry: effective([entities.mesa, entities.canyon, entities.lumber, entities.flatbed], {
      cargoMassKg: null,
      ruleContextComplete: false,
    }),
    late: effective([entities.south, entities.north, entities.transformer, entities.curtain], {
      actualStartAt: "2026-10-20T05:10:00.000Z",
      actualCompletedAt: "2026-10-20T07:42:00.000Z",
      actualDistanceM: "702300",
      cargoMassKg: "21000",
    }),
  };
  const review: S["Review"] = {
    ...base,
    trip: {
      ...base.trip,
      summary,
      manualRevision: current,
      evidence:
        key === "telemetry" ? [] : key === "over" ? evidenceItems : evidenceItems.slice(0, 1),
      decisions:
        key === "resubmission"
          ? [decision(1, "rejected", rejection, "2026-10-30T21:40:00.000Z")]
          : key === "late"
            ? [decision(2, "accepted", "Fictional waiver", "2026-10-21T10:00:00.000Z", true)]
            : [],
      reviewReasonCodes: holds[key],
      ...(facts[key] ? { effectiveFacts: facts[key] } : {}),
    },
    factRevisionId: uuid("47900000", Object.keys(reviewIds).indexOf(key) + 1),
    qualificationCheck: checks[key],
    acceptance:
      key === "over"
        ? { mode: "over_limits", blockedReasonCodes: [] }
        : key === "late"
          ? { mode: "unavailable", blockedReasonCodes: ["telemetry_source_present"] }
          : { mode: "ordinary", blockedReasonCodes: [] },
    canDecide: key !== "own",
    blockedReasonCodes: key === "own" ? ["self_review_forbidden"] : [],
  };
  const queued: S["TripSummary"] = {
    ...summary,
    review: {
      hold: true,
      reasonCodes:
        key === "over"
          ? ["rule_mass_exceeded", "rule_trailer_type_disallowed"]
          : key === "late"
            ? ["confirmed_facts_require_review", "rule_adr_category_unknown"]
            : key === "telemetry"
              ? ["qualification_history_unknown", "clock_anomaly"]
              : [],
      createdAt: current?.submittedAt ?? "2026-10-28T16:00:00.000Z",
      manualRevision: current ? { number: current.number, submittedAt: current.submittedAt } : null,
    },
  };
  return { version: 1, review, summary: queued };
}

export type ReviewMockOptions = {
  locale?: "en" | "ru";
  /** Awaiting list replaced by an empty page or an HTTP failure. */
  awaiting?: "empty" | number;
  /** Status of the first decision POST (later ones succeed). */
  firstDecision?: number;
  /** Session without trips.review. */
  forbidden?: boolean;
  /**
   * Two-item pages: the first page ends with a cursor bound to its source filter
   * (`page-2.<source|any>`), and a cursor replayed under another source answers 409.
   */
  paged?: boolean;
};
export type ReviewMock = {
  lists: URLSearchParams[];
  posts: { path: string; headers: Record<string, string>; body: Record<string, unknown> }[];
  states: Record<ReviewTrip, ReviewState>;
  /** Makes the awaiting list answer normally again. */
  recover: () => void;
  /** Makes every later cursor answer 409, like an expired or rotated cursor. */
  expire: () => void;
};
const order: ReviewTrip[] = ["late", "over", "telemetry", "own", "resubmission"];

/** Mocks the review queue, review reads, revisions, catalog labels, evidence and decisions. */
export async function mockReview(page: Page, options: ReviewMockOptions = {}): Promise<ReviewMock> {
  const locale = options.locale ?? "en";
  await mockCatalogs(page);
  const states = Object.fromEntries(order.map((key) => [key, build(key, locale)])) as Record<
    ReviewTrip,
    ReviewState
  >;
  let awaiting = options.awaiting,
    expired = false;
  const mock: ReviewMock = {
    lists: [],
    posts: [],
    states,
    recover: () => {
      awaiting = undefined;
    },
    expire: () => {
      expired = true;
    },
  };
  const keyOf = (id: string) => order.find((key) => reviewIds[key] === id);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/v1/me") {
      const self = accountFixture(locale);
      self.data.member.roles = ["dispatcher"];
      if (!options.forbidden) self.data.capabilities.push("trips.review");
      return route.fulfill({ json: self });
    }
    if (path === "/api/v1/trips") {
      mock.lists.push(url.searchParams);
      const hold = url.searchParams.get("hold") === "true",
        game = url.searchParams.get("game"),
        source = url.searchParams.get("source"),
        cursor = url.searchParams.get("cursor"),
        bound = `page-2.${source ?? "any"}`;
      if (hold && typeof awaiting === "number")
        return route.fulfill({ status: awaiting, json: { error: { code: "PRIVATE_SENTINEL" } } });
      let items = order
        .map((key) => states[key])
        .filter((state) => (state.summary.review?.hold ?? false) === hold)
        .map((state) => state.summary)
        .filter((summary) => !game || summary.game === game)
        .filter((summary) => !source || summary.sourceKinds.some((kind) => kind === source));
      if (hold && awaiting === "empty") items = [];
      if (url.searchParams.get("order") === "desc") items = items.reverse();
      if (cursor !== null && (expired || cursor !== bound))
        return route.fulfill({ status: 409, json: { error: { code: "PRIVATE_SENTINEL" } } });
      if (options.paged)
        return route.fulfill({
          json: cursor
            ? list(items.slice(2))
            : list(items.slice(0, 2), items.length > 2 ? bound : null),
        });
      return route.fulfill({ json: list(items) });
    }
    const match = /^\/api\/v1\/trips\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
    if (match) {
      const key = keyOf(match[1] ?? "");
      if (!key)
        return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
      const state = states[key],
        rest = match[2] ?? "";
      if (rest === "/review")
        return route.fulfill({
          json: envelope(state.review),
          headers: { ETag: `"v${state.version}"` },
        });
      if (rest === "/manual-revisions") return route.fulfill({ json: list(revisions[key]) });
      if (rest === "/proposals" || rest === "/correction-requests" || rest === "/reconciliations")
        return route.fulfill({ json: list([]) });
      if (rest === "/decisions" && request.method() === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        mock.posts.push({ path, headers: request.headers(), body });
        if (mock.posts.length === 1 && options.firstDecision) {
          state.version++;
          return route.fulfill({
            status: options.firstDecision,
            json: { error: { code: "PRIVATE_SENTINEL" } },
          });
        }
        const outcome = body.decision === "accept" ? "accepted" : "rejected",
          made = decision(
            10 + mock.posts.length,
            outcome,
            String(body.reason),
            "2026-11-01T12:00:00.000Z",
            body.confirmOverLimits === true,
          );
        state.version++;
        state.review.trip.decisions = [made, ...state.review.trip.decisions];
        state.review.trip.summary = { ...state.review.trip.summary, decision: outcome };
        state.summary = {
          ...state.summary,
          decision: outcome,
          ...(state.summary.review ? { review: { ...state.summary.review, hold: false } } : {}),
        };
        return route.fulfill({ json: envelope(made), headers: { ETag: `"v${state.version}"` } });
      }
      if (!rest)
        return route.fulfill({
          json: envelope({ ...state.review.trip, summary: state.review.trip.summary }),
          headers: { ETag: `"v${state.version}"` },
        });
      return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
    }
    if (path.startsWith("/api/v1/catalogs/entities/")) {
      const id = path.split("/").at(-1) ?? "",
        known = labels[id],
        requested = url.searchParams.get("locale") === "ru" ? "ru" : "en";
      if (!known || url.searchParams.get("revisionId") !== catalogRevisionId)
        return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
      return route.fulfill({
        json: envelope({
          id,
          revisionId: catalogRevisionId,
          game: known.game ?? "ets2",
          kind: known.kind,
          mapNamespace: "base",
          display: { ...label(id, requested), label: known[requested] },
          relatedEntityIds: [],
        }),
      });
    }
    if (path === `/api/v1/evidence/${evidence.ready}/content`)
      return route.fulfill({ body: pngBytes(), headers: { "Content-Type": "image/png" } });
    if (path.startsWith("/api/v1/evidence/") && path.endsWith("/content"))
      return route.fulfill({ status: 410, json: { error: { code: "EVIDENCE_EXPIRED" } } });
    if (path === "/api/v1/events") return route.fulfill({ json: list([]) });
    if (path === "/api/v1/me/upcoming-event") return route.fulfill({ json: envelope(null) });
    return route.fallback();
  });
  return mock;
}
