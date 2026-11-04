import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  checkRows,
  decisionBody,
  decisionState,
  diffRows,
  historyItems,
  isOwn,
  listQuery,
  previousRevision,
  queueParams,
  queueSearch,
  queueType,
  reviewType,
  ruleFlag,
  shortDate,
  submittedAt,
} from "../../apps/web/src/features/review/review-model.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { type DTO, queryString, schema } from "../../apps/web/src/features/trips/transport.ts";

// Synthetic contract examples only; identities and reasons are fictional.
const cases = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
).cases as { id: string; response: { data: unknown }; request?: unknown }[];
const example = <T>(id: string): T => {
  const found = cases.find((c) => c.id === id);
  if (!found) throw new Error(`MISSING_EXAMPLE ${id}`);
  return structuredClone(found.response.data) as T;
};
const trip = "41000000-0000-4000-8000-000000000001";
const overLimits = () => example<DTO["Review"]>("getTripReview:over-limits");
const ordinary = () => {
  const review = overLimits();
  review.acceptance = { mode: "ordinary", blockedReasonCodes: [] };
  review.qualificationCheck.rules = review.qualificationCheck.rules.map((rule) => ({
    ...rule,
    outcome: "pass",
    reasonCode: "rule_passed",
  }));
  return review;
};
const queueEntry = () =>
  example<DTO["ListTripSummary"]>("listTrips:review-queue").items[0] as DTO["TripSummary"];

describe("queue parameters", () => {
  test("defaults, tab-specific order and invalid values", () => {
    expect(queueParams(new URLSearchParams())).toEqual({
      tab: "awaiting",
      game: undefined,
      decision: undefined,
      order: "asc",
      trip: null,
    });
    expect(queueParams(new URLSearchParams("tab=decided"))).toMatchObject({ order: "desc" });
    expect(
      queueParams(
        new URLSearchParams("tab=wrong&game=gta&decision=accepted&order=up&trip=not-a-uuid"),
      ),
    ).toEqual({ tab: "awaiting", game: undefined, decision: undefined, order: "asc", trip: null });
    expect(
      queueParams(
        new URLSearchParams(`tab=decided&game=ats&decision=rejected&order=asc&trip=${trip}`),
      ),
    ).toEqual({ tab: "decided", game: "ats", decision: "rejected", order: "asc", trip });
  });
  test("list queries bind hold, order and the decided-only decision", () => {
    const awaiting = queueParams(new URLSearchParams("game=ets2&decision=accepted"));
    expect(queryString(listQuery(awaiting, null))).toBe(
      "scope=review&hold=true&game=ets2&order=asc&limit=25",
    );
    const decided = queueParams(new URLSearchParams(`tab=decided&decision=accepted&trip=${trip}`));
    expect(queryString(listQuery(decided, "next"))).toBe(
      "scope=review&hold=false&decision=accepted&order=desc&limit=25&cursor=next",
    );
  });
  test("back links keep validated non-default filters only", () => {
    expect(queueSearch(new URLSearchParams(`trip=${trip}&cursor=x&order=asc`))).toBe("");
    expect(queueSearch(new URLSearchParams("tab=decided&game=ats&order=asc&secret=1"))).toBe(
      "?tab=decided&game=ats&order=asc",
    );
  });
});

describe("queue rows", () => {
  test("queue type precedence: late telemetry, resubmission, manual, telemetry", () => {
    const entry = queueEntry();
    expect(queueType(entry)).toBe("resubmission");
    if (!entry.review) throw new Error("MISSING_REVIEW_BLOCK");
    entry.review.reasonCodes = ["confirmed_facts_require_review"];
    expect(queueType(entry)).toBe("late_telemetry");
    entry.review.reasonCodes = [];
    entry.review.manualRevision = { number: 1, submittedAt: "2026-10-17T12:00:00.000Z" };
    expect(queueType(entry)).toBe("manual");
    entry.review.manualRevision = null;
    expect(queueType(entry)).toBe("telemetry");
    const review = overLimits();
    expect(reviewType(review.trip)).toBe("resubmission");
    review.trip.reviewReasonCodes = ["confirmed_facts_require_review"];
    expect(reviewType(review.trip)).toBe("late_telemetry");
  });
  test("rules flag, own rows and queue time", () => {
    expect(ruleFlag(["rule_mass_unknown", "rule_trailer_type_disallowed"])).toBe("exceeded");
    expect(ruleFlag(["rule_adr_category_unknown"])).toBe("check");
    expect(ruleFlag(["qualification_history_unknown"])).toBe("check");
    expect(ruleFlag(["manual_requires_other_reviewer"])).toBe("none");
    const entry = queueEntry();
    expect(isOwn(entry, entry.owner.id)).toBe(true);
    expect(isOwn(entry, undefined)).toBe(false);
    expect(submittedAt(entry)).toBe("2026-10-17T12:00:00.000Z");
    expect(shortDate("2026-10-17T12:00:00.000Z", "en", "UTC")).toMatch(/17 Oct/);
    expect(shortDate(null, "ru", "UTC")).toBeNull();
  });
});

describe("revision diff", () => {
  const items = example<DTO["ListManualRevision"]>("listManualRevisions:extended-history").items;
  const [second, legacy] = items as [DTO["ManualRevisionRead"], DTO["ManualRevisionRead"]];
  test("first submissions have no previous column", () => {
    const rows = diffRows(second, null);
    expect(rows.map((row) => row.field)).toEqual([
      "game",
      "origin",
      "destination",
      "cargo",
      "cargoMassKg",
      "trailerType",
      "actualDistanceM",
      "eventId",
      "comment",
      "evidenceIds",
    ]);
    expect(rows.every((row) => !("previous" in row) && !row.changed)).toBe(true);
  });
  test("changed and unchanged rows against the same report only", () => {
    const first = structuredClone(second) as DTO["ManualReportRevision"];
    first.id = "51000000-0000-4000-8000-000000000017";
    first.number = 1;
    first.fields.cargoMassKg = "21000";
    expect(previousRevision(second, [second, first, legacy])).toBe(first);
    expect(previousRevision(second, [second, { ...first, reportId: trip }])).toBeNull();
    expect(previousRevision(legacy, items)).toBeNull();
    const rows = diffRows(second, first);
    expect(rows.find((row) => row.field === "cargoMassKg")).toEqual({
      field: "cargoMassKg",
      current: "0",
      previous: "21000",
      changed: true,
    });
    expect(rows.filter((row) => row.changed).map((row) => row.field)).toEqual(["cargoMassKg"]);
    // IDs stay IDs; labels are resolved by the components.
    expect(rows.find((row) => row.field === "origin")?.current).toMatchObject({
      status: "resolved",
      entityId: "51000000-0000-4000-8000-000000000001",
    });
  });
});

test("qualification check rows: four states with text symbols and the unresolved row", () => {
  const check: DTO["QualificationCheck"] = {
    status: "resolved",
    reasonCode: null,
    rules: (["pass", "fail", "unknown", "pass"] as const).map((outcome, index) => ({
      ruleType: "max_mass",
      outcome,
      reasonCode: "rule_passed",
      bypassedByEvent: index === 3,
      observedMassKg: null,
      limitMassKg: null,
      entityIds: [],
    })),
  };
  const rows = checkRows(check);
  expect(rows.map((row) => [row.state, row.symbol])).toEqual([
    ["pass", "✓"],
    ["fail", "✕"],
    ["unknown", "?"],
    ["bypassed", "◇"],
  ]);
  expect(rows.some((row) => row.symbol === "◆")).toBe(false);
  expect(
    checkRows({ status: "unresolved", reasonCode: "qualification_history_unknown", rules: [] }),
  ).toMatchObject([{ state: "unavailable", reasonCode: "qualification_history_unknown" }]);
});

describe("decision state", () => {
  const state = (
    review: DTO["Review"],
    choice: "accept" | "reject" | null,
    reason = "Synthetic note",
    confirmed = false,
    seconds = 0,
  ) => decisionState({ review, choice, reason, confirmed, seconds });
  test("self review, blocked reads, missing choice, blank or long reason and waiting", () => {
    const self = ordinary();
    self.canDecide = false;
    self.blockedReasonCodes = ["self_review_forbidden"];
    expect(state(self, "reject")).toMatchObject({ canSubmit: false, blocker: "self" });
    const blocked = ordinary();
    blocked.canDecide = false;
    expect(state(blocked, "reject").blocker).toBe("blocked");
    expect(state(ordinary(), null)).toMatchObject({ blocker: "choice", submitLabel: "record" });
    expect(state(ordinary(), "reject", "  \n ")).toMatchObject({
      blocker: "reason",
      reasonLabel: "rejection",
    });
    expect(state(ordinary(), "reject", "x".repeat(2049)).blocker).toBe("length");
    expect(state(ordinary(), "accept", "Synthetic", false, 3).blocker).toBe("wait");
    expect(state(ordinary(), "accept")).toMatchObject({
      canSubmit: true,
      needsConfirmation: false,
      reasonLabel: "note",
      submitLabel: "accept",
      exceeded: [],
    });
  });
  test("unavailable acceptance blocks accept only; over limits needs confirmation", () => {
    const telemetry = ordinary();
    telemetry.acceptance = {
      mode: "unavailable",
      blockedReasonCodes: ["telemetry_source_present"],
    };
    expect(state(telemetry, "accept")).toMatchObject({
      canSubmit: false,
      blocker: "unavailable",
      blockedCodes: ["telemetry_source_present"],
    });
    expect(state(telemetry, "reject").canSubmit).toBe(true);
    const over = overLimits();
    expect(state(over, "accept")).toMatchObject({
      canSubmit: false,
      needsConfirmation: true,
      blocker: "confirm",
    });
    expect(state(over, "accept").exceeded.map((rule) => rule.ruleType)).toEqual(["max_mass"]);
    expect(state(over, "accept", "Synthetic", true).canSubmit).toBe(true);
    expect(state(over, "reject")).toMatchObject({ canSubmit: true, needsConfirmation: false });
  });
});

test("decision bodies add the flag only to a confirmed over-limit accept", () => {
  const over = overLimits(),
    reviewed = "41000000-0000-4000-8000-000000000002";
  const accepted = decisionBody({
    review: over,
    choice: "accept",
    reason: " Synthetic waiver ",
    confirmed: true,
  });
  expect(accepted).toEqual({
    decision: "accept",
    reviewedRevisionId: reviewed,
    factRevisionId: over.factRevisionId,
    proposalId: null,
    reason: "Synthetic waiver",
    confirmOverLimits: true,
  });
  expect(schema("DecisionInput").safeParse(accepted).success).toBe(true);
  expect(
    decisionBody({ review: over, choice: "accept", reason: "x", confirmed: false }),
  ).not.toHaveProperty("confirmOverLimits");
  expect(
    decisionBody({ review: over, choice: "reject", reason: "x", confirmed: true }),
  ).not.toHaveProperty("confirmOverLimits");
  // Ordinary bodies are byte-identical to the request before VTC-059.
  for (const choice of ["accept", "reject"] as const) {
    const review = ordinary(),
      body = decisionBody({ review, choice, reason: "  Synthetic\nnote ", confirmed: true });
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        decision: choice,
        reviewedRevisionId: review.trip.manualRevision?.id ?? review.factRevisionId,
        factRevisionId: review.factRevisionId,
        proposalId: null,
        reason: "Synthetic\nnote",
      }),
    );
  }
  // Telemetry-only trips review their fact revision.
  const telemetry = example<DTO["Review"]>("getTripReview:success");
  expect(
    decisionBody({ review: telemetry, choice: "reject", reason: "x", confirmed: false })
      .reviewedRevisionId,
  ).toBe(telemetry.factRevisionId);
});

test("history items are newest first with reviewer, system decisions and the marker", () => {
  const revisions = example<DTO["ListManualRevision"]>(
    "listManualRevisions:extended-history",
  ).items;
  const over = example<DTO["Decision"]>("decideTrip:accepted-over-limits");
  const system = { ...over, id: trip, reviewer: null, acceptedOverLimits: false };
  system.decidedAt = "2026-10-20T12:00:00.000Z";
  system.outcome = "rejected";
  const items = historyItems(revisions, [over, system]);
  expect(items.map((item) => [item.kind, item.at])).toEqual([
    ["decision", "2026-10-20T12:00:00.000Z"],
    ["revision", "2026-10-20T12:00:00.000Z"],
    ["decision", "2026-10-17T12:00:00.000Z"],
    ["revision", "2026-10-17T12:00:00.000Z"],
  ]);
  expect(items[0]).toMatchObject({ reviewer: null, overLimits: false, outcome: "rejected" });
  expect(items[2]).toMatchObject({ reviewer: "Fixture Dispatcher", overLimits: true });
});

test("review examples parse with the generated runtime envelopes", () => {
  const response = (id: string) => cases.find((c) => c.id === id)?.response;
  for (const id of ["getTripReview:success", "getTripReview:over-limits"])
    expect(schema("EnvelopeReview").safeParse(response(id)).success, id).toBe(true);
  for (const id of ["decideTrip:success", "decideTrip:accepted-over-limits"])
    expect(schema("EnvelopeDecision").safeParse(response(id)).success, id).toBe(true);
  expect(
    schema("EnvelopeListTripSummary").safeParse(response("listTrips:review-queue")).success,
  ).toBe(true);
  const request = cases.find((c) => c.id === "decideTrip:accepted-over-limits")?.request;
  expect(schema("DecisionInput").safeParse(request).success).toBe(true);
});

test("review copy is bilingual, inside the font subsets and never shows the mockup slogan", () => {
  expect(Object.keys(tripTranslations.en).sort()).toEqual(Object.keys(tripTranslations.ru).sort());
  // Symbols the Huninn subsets render plus the documented system fallbacks (✓, ✕, …).
  const allowed = new Set([..."←↑→↓—№∅◇●×•«»·–✓✕…"]);
  const directory = fileURLToPath(new URL("../../apps/web/src/features/review/", import.meta.url));
  const files = [
    ...readdirSync(directory).map((name) => join(directory, name)),
    fileURLToPath(new URL("../../apps/web/src/features/trips/translations.ts", import.meta.url)),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const extra = [...text].filter(
      (character) => character.charCodeAt(0) > 127 && !/[А-Яа-яЁё]/.test(character),
    );
    expect(
      extra.filter((character) => !allowed.has(character)),
      String(file),
    ).toEqual([]);
    expect(text).not.toMatch(/Достаточно суров|Юкон\?/);
  }
});
