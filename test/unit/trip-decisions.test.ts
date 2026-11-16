import { describe, expect, test } from "vitest";
import type { QualificationLimits } from "../../apps/api/src/modules/qualifications/check.ts";
import type { AdrClass } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import {
  acceptance,
  classify,
  evaluationSnapshot,
  type Historical,
  qualificationSnapshot,
} from "../../apps/api/src/modules/trip-decisions/evaluation.ts";
import {
  createSyntheticManualEvidence,
  createSyntheticTripEvidence,
  knownFact,
  pinnedEntityFact,
  unknownFact,
} from "../fixtures/trip-evidence.ts";
import { SYNTHETIC_IDS } from "../fixtures/trip-evidence.ts";

const open: QualificationLimits = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", typeIds: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
const level = (limits: Partial<QualificationLimits> = {}): Historical => ({
  status: "resolved",
  assignmentId: "assignment",
  levelId: "level",
  levelName: "Fictional level",
  editVersion: 1,
  limits: { ...open, massMaxKg: "20000", ...limits },
  attributionAt: "2026-10-21T10:00:00.000Z",
  attributionBasis: "actual_start",
});
const history = level();
const tight = level({ massMaxKg: "1" });
const unresolved = (attributionBasis: Historical["attributionBasis"]): Historical => ({
  status: "unresolved",
  reasonCode: "qualification_level_unknown",
  attributionBasis,
  attributionAt: null,
});
describe("trip decision knowledge/lifecycle gates", () => {
  test("accepts supported completion, rejects proven violations and keeps uncontested open unassessed", () => {
    const e = createSyntheticTripEvidence();
    expect(classify(e, history, null).decision).toBe("accepted");
    expect(classify({ ...e, outcome: "open" }, history, null).decision).toBe("unassessed");
    expect(classify({ ...e, outcome: "cancelled" }, history, null).decision).toBe("rejected");
    expect(
      classify(
        {
          ...e,
          cargoMassKg: {
            status: "known",
            value: "21000",
            sourceRecordId: e.sourceRecordId,
            sourceField: "test",
          },
        },
        history,
        null,
      ).decision,
    ).toBe("rejected");
  });
  test("reversed unverified checkpoint or anomalous times are uncertainty while independent rule violations retain precedence", () => {
    const e = createSyntheticTripEvidence();
    const unreliable = {
      ...e,
      start: {
        utc: "2026-10-21T12:00:00.000Z",
        basis: "checkpoint" as const,
        verifiedActual: false,
      },
      end: { utc: "2026-10-21T11:00:00.000Z", basis: "last-known" as const, verifiedActual: false },
    };
    expect(classify(unreliable, history, null).decision).toBe("pending_review");
    expect(classify(unreliable, history, null).reasons).not.toContain("actual_time_order_invalid");
    expect(classify(unreliable, tight, null).decision).toBe("rejected");
  });
  test("open zero-distance snapshots remain nonterminal when reconciliation requires review", () => {
    const e = createSyntheticTripEvidence();
    const open = {
      ...e,
      outcome: "open" as const,
      actualDistanceM: {
        status: "known" as const,
        value: "0",
        sourceRecordId: e.sourceRecordId,
        sourceField: "test",
      },
    };
    expect(classify(open, history, null, ["candidate_search_overflow"]).decision).toBe(
      "pending_review",
    );
    expect(classify(open, history, null, [], true).decision).toBe("pending_review");
  });
  test("closed without reliable outcome routes review while independently proven violations still reject", () => {
    const e = {
      ...createSyntheticTripEvidence(),
      outcome: "none" as const,
      recording: "partial" as const,
    };
    expect(classify(e, history, null).decision).toBe("pending_review");
    expect(classify(e, tight, null).decision).toBe("rejected");
  });
  test.each([
    "recording",
    "start",
    "end",
    "actualDistanceM",
    "origin",
    "destination",
    "cargo",
    "trailers",
  ])("missing %s is review, never a proven violation", (field) => {
    const e = createSyntheticTripEvidence();
    const patch =
      field === "recording"
        ? { recording: "unknown" as const }
        : field === "start" || field === "end"
          ? { [field]: { utc: null, basis: "unknown", verifiedActual: false } }
          : field === "trailers"
            ? { trailers: { complete: false, items: [] } }
            : { [field]: unknownFact() };
    expect(classify({ ...e, ...patch }, history, null).decision).toBe("pending_review");
  });
  test("unresolved history and reconciliation ambiguity never accept using current rules", () => {
    expect(classify(createSyntheticTripEvidence(), unresolved("actual_start"), null).decision).toBe(
      "pending_review",
    );
    expect(
      classify(createSyntheticTripEvidence(), history, null, ["ambiguous_sources"]).decision,
    ).toBe("pending_review");
  });
  test("manual-only always requires a different human, even when checks fail", () => {
    const e = createSyntheticManualEvidence();
    expect(classify(e, history, null).decision).toBe("pending_review");
    expect(classify(e, tight, null).decision).toBe("pending_review");
    expect(classify(e, history, null, [], true).decision).toBe("accepted");
  });
  test("pending manual group requires a human even when complete selected telemetry passes or fails", () => {
    const e = createSyntheticTripEvidence();
    expect(classify(e, history, null, [], false, true).decision).toBe("pending_review");
    expect(classify(e, tight, null, [], false, true).decision).toBe("pending_review");
    expect(classify(e, history, null, [], true, true).decision).toBe("accepted");
  });
  test("a confirmed company event trip is credited without the level limits", () => {
    const e = createSyntheticTripEvidence(),
      event = {
        eventId: "event",
        eventRevisionId: "revision",
        attendanceRevisionId: "attendance",
        attendanceStatus: "confirmed" as const,
        prescribedCargoId: null,
        prescribedMassKg: null,
        prescribedTrailerTypeId: null,
      };
    expect(classify(e, tight, event).decision).toBe("accepted");
    expect(classify(e, tight, { ...event, attendanceStatus: "unconfirmed" }).decision).toBe(
      "rejected",
    );
    // Knowledge gates still apply to event trips.
    expect(classify({ ...e, recording: "partial" }, tight, event).decision).toBe("pending_review");
    expect(qualificationSnapshot(e, tight, event)).toMatchObject({
      levelId: "level",
      eventExempt: true,
      outcome: null,
      rules: [],
    });
  });
  test("manual confirmation stays decision time and staff telemetry timing remains explicit", () => {
    const e = createSyntheticManualEvidence(),
      manualHistory = { ...history, attributionBasis: "manual_confirmation" as const };
    expect(evaluationSnapshot(e, manualHistory, null, "2026-10-22T12:00:00.000Z").reportingAt).toBe(
      "2026-10-22T12:00:00.000Z",
    );
    expect(e.start.utc).toBeNull();
    const telemetry = createSyntheticTripEvidence();
    telemetry.start.basis = "staff-resolution";
    expect(evaluationSnapshot(telemetry, history, null, "ignored").attributionBasis).toBe(
      "staff_resolution",
    );
  });
});

describe("over-limit acceptance and the qualification snapshot", () => {
  const ids = SYNTHETIC_IDS,
    selected = {
      trailers: { mode: "selected" as const, typeIds: [ids.TRAILER_STANDARD] },
      adr: { mode: "selected" as const, classes: ["2" as const] },
    },
    limits = level(selected),
    manualOnly = { hasTelemetrySource: false, eventInvalid: false, eventReviewRequired: false },
    mass = (value: string) => knownFact(value, "manual.cargoMassKg"),
    overMass = () => createSyntheticManualEvidence({ cargoMassKg: mass("21000") });
  test("a manual report breaking only the mass limit is acceptable over limits with exact details", () => {
    const e = overMass();
    expect(acceptance(e, limits, null, manualOnly)).toEqual({
      mode: "over_limits",
      exceeded: ["qualification_cargo_mass"],
      blockedReasonCodes: [],
    });
    const snapshot = qualificationSnapshot(e, limits, null);
    expect(snapshot).toMatchObject({
      levelId: "level",
      levelName: "Fictional level",
      editVersion: 1,
      eventExempt: false,
      outcome: "fail",
      reasonCode: null,
    });
    expect(snapshot.rules.map((rule) => [rule.rule, rule.result])).toEqual([
      ["cargo_mass", "fail"],
      ["distance", "pass"],
      ["trailer_types", "pass"],
      ["adr", "pass"],
      ["hard_mode", "pass"],
    ]);
    expect(snapshot.rules[0]).toEqual({
      rule: "cargo_mass",
      result: "fail",
      minKg: null,
      maxKg: "20000",
      observedKg: "21000",
    });
    expect(acceptance(createSyntheticManualEvidence(), limits, null, manualOnly)).toEqual({
      mode: "ordinary",
      exceeded: [],
      blockedReasonCodes: [],
    });
  });
  test("every exceeded limit is listed, including trailer, ADR and Hard Mode", () => {
    const e = createSyntheticManualEvidence({
      cargoMassKg: mass("21000"),
      trailers: {
        complete: true,
        items: [
          pinnedEntityFact(ids.TRAILER_STANDARD, "trailer_type"),
          pinnedEntityFact(ids.TRAILER_DISALLOWED, "trailer_type"),
        ],
      },
      adrCategory: knownFact<AdrClass>("6", "snapshot.adr"),
      recordedTelemetry: {
        jobType: "freight-market",
        gameMode: "single-player",
        hardModeResult: "not-qualified",
      },
    });
    const hard = level({ ...selected, hardModeRequired: true });
    expect(acceptance(e, hard, null, manualOnly)).toEqual({
      mode: "over_limits",
      exceeded: [
        "qualification_adr",
        "qualification_cargo_mass",
        "qualification_hard_mode",
        "qualification_trailer",
      ],
      blockedReasonCodes: [],
    });
    const rules = qualificationSnapshot(e, hard, null).rules;
    expect(rules.find((r) => r.rule === "trailer_types")).toMatchObject({
      result: "fail",
      observedIds: [ids.TRAILER_STANDARD, ids.TRAILER_DISALLOWED].sort(),
    });
    expect(rules.find((r) => r.rule === "adr")).toMatchObject({ result: "fail", observed: "6" });
  });
  test("a telemetry source, an event review or a non-limit violation makes acceptance unavailable", () => {
    const e = overMass();
    expect(acceptance(e, limits, null, { ...manualOnly, hasTelemetrySource: true })).toEqual({
      mode: "unavailable",
      exceeded: ["qualification_cargo_mass"],
      blockedReasonCodes: ["telemetry_source_present"],
    });
    expect(
      acceptance(e, limits, null, { ...manualOnly, eventReviewRequired: true }).blockedReasonCodes,
    ).toEqual(["event_requires_review"]);
    expect(
      acceptance(createSyntheticManualEvidence(), limits, null, {
        ...manualOnly,
        eventInvalid: true,
      }),
    ).toMatchObject({ mode: "unavailable", blockedReasonCodes: ["event_requires_review"] });
    expect(acceptance({ ...e, outcome: "cancelled" }, limits, null, manualOnly)).toMatchObject({
      mode: "unavailable",
      blockedReasonCodes: ["terminal_outcome_not_delivered"],
    });
    expect(acceptance({ ...e, outcome: "open" }, limits, null, manualOnly)).toMatchObject({
      mode: "unavailable",
      blockedReasonCodes: ["trip_open"],
    });
    // Ordinary telemetry acceptance is unchanged by the source rule.
    expect(
      acceptance(createSyntheticTripEvidence(), limits, null, {
        ...manualOnly,
        hasTelemetrySource: true,
      }).mode,
    ).toBe("ordinary");
  });
  test("unknown limits, missing facts and an unresolved level block acceptance even beside a breach", () => {
    const e = createSyntheticManualEvidence({
      cargoMassKg: mass("21000"),
      adrCategory: unknownFact<AdrClass>("data_unknown"),
    });
    expect(classify(e, limits, null, [], true).reasons).toEqual(["qualification_cargo_mass"]);
    expect(acceptance(e, limits, null, manualOnly)).toEqual({
      mode: "unavailable",
      exceeded: ["qualification_cargo_mass"],
      blockedReasonCodes: ["qualification_unknown"],
    });
    expect(
      acceptance({ ...overMass(), origin: unknownFact() }, limits, null, manualOnly)
        .blockedReasonCodes,
    ).toEqual(["origin_unknown"]);
    const none = unresolved("manual_confirmation");
    expect(acceptance(overMass(), none, null, manualOnly)).toEqual({
      mode: "unavailable",
      exceeded: [],
      blockedReasonCodes: ["qualification_level_unknown"],
    });
    expect(qualificationSnapshot(overMass(), none, null)).toEqual({
      levelId: null,
      levelName: null,
      editVersion: null,
      limits: null,
      eventExempt: false,
      outcome: null,
      reasonCode: "qualification_level_unknown",
      rules: [],
    });
    const unknownMass = qualificationSnapshot(
      createSyntheticManualEvidence({ cargoMassKg: unknownFact("data_unknown") }),
      limits,
      null,
    ).rules[0];
    expect(unknownMass).toMatchObject({ result: "unknown", observedKg: null, maxKg: "20000" });
  });
  test("an unknown Hard Mode result sends an otherwise passing trip to staff review", () => {
    const hard = level({ hardModeRequired: true });
    expect(classify(createSyntheticManualEvidence(), hard, null, [], true)).toEqual({
      decision: "pending_review",
      reasons: ["qualification_unknown"],
    });
    const telemetry = createSyntheticTripEvidence({
      recordedTelemetry: {
        jobType: "freight-market",
        gameMode: "single-player",
        hardModeResult: "qualified",
      },
    });
    expect(classify(telemetry, hard, null).decision).toBe("accepted");
  });
});
