import { describe, expect, test } from "vitest";
import type { AdrClass } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import {
  acceptance,
  classify,
  evaluationSnapshot,
  type Historical,
  qualificationCheck,
} from "../../apps/api/src/modules/trip-decisions/evaluation.ts";
import {
  createSyntheticManualEvidence,
  createSyntheticTripEvidence,
  knownFact,
  pinnedEntityFact,
  unknownFact,
} from "../fixtures/qualification-rules/fixtures.ts";
import { SYNTHETIC_IDS } from "../fixtures/qualification-rules/synthetic-rules.ts";

const history: Historical = {
  status: "resolved",
  assignmentId: "assignment",
  levelId: "level",
  ruleVersionId: "rules",
  rules: [{ type: "max_mass", maxKg: "20000" }],
  assignedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  attributionAt: "2026-10-21T10:00:00.000Z",
  attributionBasis: "actual_start",
};
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
    expect(
      classify(unreliable, { ...history, rules: [{ type: "max_mass", maxKg: "1" }] }, null)
        .decision,
    ).toBe("rejected");
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
    expect(
      classify(e, { ...history, rules: [{ type: "max_mass", maxKg: "1" }] }, null).decision,
    ).toBe("rejected");
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
    expect(
      classify(
        createSyntheticTripEvidence(),
        {
          status: "unresolved",
          reasonCode: "qualification_history_unknown",
          attributionBasis: "actual_start",
          attributionAt: null,
        },
        null,
      ).decision,
    ).toBe("pending_review");
    expect(
      classify(createSyntheticTripEvidence(), history, null, ["ambiguous_sources"]).decision,
    ).toBe("pending_review");
  });
  test("manual-only always requires a different human, even when checks fail", () => {
    const e = createSyntheticManualEvidence();
    expect(classify(e, history, null).decision).toBe("pending_review");
    expect(
      classify(e, { ...history, rules: [{ type: "max_mass", maxKg: "1" }] }, null).decision,
    ).toBe("pending_review");
    expect(classify(e, history, null, [], true).decision).toBe("accepted");
  });
  test("pending manual group requires a human even when complete selected telemetry passes or fails", () => {
    const e = createSyntheticTripEvidence();
    expect(classify(e, history, null, [], false, true).decision).toBe("pending_review");
    expect(
      classify(e, { ...history, rules: [{ type: "max_mass", maxKg: "1" }] }, null, [], false, true)
        .decision,
    ).toBe("pending_review");
    expect(classify(e, history, null, [], true, true).decision).toBe("accepted");
  });
  test("event only bypasses prescribed matching ordinary restrictions with current confirmed attendance", () => {
    const e = createSyntheticTripEvidence(),
      event = {
        eventId: "event",
        eventRevisionId: "revision",
        attendanceRevisionId: "attendance",
        attendanceStatus: "confirmed" as const,
        prescribedCargoId: null,
        prescribedMassKg: "18000",
        prescribedTrailerTypeId: null,
      },
      restricted = { ...history, rules: [{ type: "max_mass", maxKg: "1" }] };
    expect(classify(e, restricted, event).decision).toBe("accepted");
    expect(classify(e, restricted, { ...event, attendanceStatus: "unconfirmed" }).decision).toBe(
      "rejected",
    );
    expect(classify({ ...e, recording: "partial" }, restricted, event).decision).toBe(
      "pending_review",
    );
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

describe("over-limit acceptance and qualification check details", () => {
  const ids = SYNTHETIC_IDS,
    limits: Historical = {
      ...history,
      rules: [
        { type: "max_mass", maxKg: "20000" },
        { type: "allowed_trailer_types", entityIds: [ids.TRAILER_STANDARD] },
        { type: "allowed_adr_categories", classes: ["2"] },
      ],
    },
    manualOnly = { hasTelemetrySource: false, eventInvalid: false, eventReviewRequired: false },
    mass = (value: string) => knownFact(value, "manual.cargoMassKg"),
    overMass = () => createSyntheticManualEvidence({ cargoMassKg: mass("21000") }),
    event = {
      eventId: ids.EVENT_ID,
      eventRevisionId: ids.EVENT_REVISION_ID,
      attendanceRevisionId: ids.ATTENDANCE_REVISION_ID,
      attendanceStatus: "confirmed" as const,
      prescribedCargoId: null,
      prescribedMassKg: "21000",
      prescribedTrailerTypeId: null,
    };
  test("a manual report breaking only the mass limit is acceptable over limits with exact details", () => {
    const e = overMass();
    expect(acceptance(e, limits, null, manualOnly)).toEqual({
      mode: "over_limits",
      exceeded: ["rule_mass_exceeded"],
      blockedReasonCodes: [],
    });
    expect(qualificationCheck(e, limits, null)).toEqual({
      status: "resolved",
      reasonCode: null,
      rules: [
        {
          ruleType: "max_mass",
          outcome: "fail",
          reasonCode: "rule_mass_exceeded",
          bypassedByEvent: false,
          observedMassKg: "21000",
          limitMassKg: "20000",
          entityIds: [],
        },
        {
          ruleType: "allowed_trailer_types",
          outcome: "pass",
          reasonCode: "rule_passed",
          bypassedByEvent: false,
          observedMassKg: null,
          limitMassKg: null,
          entityIds: [],
        },
        {
          ruleType: "allowed_adr_categories",
          outcome: "pass",
          reasonCode: "rule_passed",
          bypassedByEvent: false,
          observedMassKg: null,
          limitMassKg: null,
          entityIds: [],
        },
      ],
    });
    expect(acceptance(createSyntheticManualEvidence(), limits, null, manualOnly)).toEqual({
      mode: "ordinary",
      exceeded: [],
      blockedReasonCodes: [],
    });
  });
  test("every exceeded limit is listed with the offending trailer and ADR entities", () => {
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
    });
    expect(acceptance(e, limits, null, manualOnly)).toEqual({
      mode: "over_limits",
      exceeded: [
        "rule_adr_category_disallowed",
        "rule_mass_exceeded",
        "rule_trailer_type_disallowed",
      ],
      blockedReasonCodes: [],
    });
    const rules = qualificationCheck(e, limits, null).rules;
    expect(rules.map((r) => [r.ruleType, r.outcome, r.entityIds])).toEqual([
      ["max_mass", "fail", []],
      ["allowed_trailer_types", "fail", [ids.TRAILER_DISALLOWED]],
      ["allowed_adr_categories", "fail", ["6"]],
    ]);
  });
  test("a telemetry source, an event review or a non-limit violation makes acceptance unavailable", () => {
    const e = overMass();
    expect(acceptance(e, limits, null, { ...manualOnly, hasTelemetrySource: true })).toEqual({
      mode: "unavailable",
      exceeded: ["rule_mass_exceeded"],
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
  test("unknown limits, missing facts and unresolved history block acceptance even beside a proven breach", () => {
    const e = createSyntheticManualEvidence({
      cargoMassKg: mass("21000"),
      adrCategory: unknownFact<AdrClass>("data_unknown"),
    });
    expect(classify(e, limits, null, [], true).reasons).toEqual(["rule_mass_exceeded"]);
    expect(acceptance(e, limits, null, manualOnly)).toEqual({
      mode: "unavailable",
      exceeded: ["rule_mass_exceeded"],
      blockedReasonCodes: ["rule_adr_category_unknown"],
    });
    expect(
      acceptance({ ...overMass(), origin: unknownFact() }, limits, null, manualOnly)
        .blockedReasonCodes,
    ).toEqual(["origin_unknown"]);
    const unresolved: Historical = {
      status: "unresolved",
      reasonCode: "qualification_history_unknown",
      attributionBasis: "manual_confirmation",
      attributionAt: null,
    };
    expect(acceptance(overMass(), unresolved, null, manualOnly)).toEqual({
      mode: "unavailable",
      exceeded: [],
      blockedReasonCodes: ["qualification_history_unknown"],
    });
    expect(qualificationCheck(overMass(), unresolved, null)).toEqual({
      status: "unresolved",
      reasonCode: "qualification_history_unknown",
      rules: [],
    });
    const unknownMass = qualificationCheck(
      createSyntheticManualEvidence({ cargoMassKg: unknownFact("data_unknown") }),
      limits,
      null,
    ).rules[0];
    expect(unknownMass).toMatchObject({
      outcome: "unknown",
      observedMassKg: null,
      limitMassKg: "20000",
    });
  });
  test("a full event exception accepts ordinarily while a partial exception blocks the override", () => {
    const full = overMass();
    expect(acceptance(full, limits, event, manualOnly).mode).toBe("ordinary");
    expect(qualificationCheck(full, limits, event).rules[0]).toEqual({
      ruleType: "max_mass",
      outcome: "pass",
      reasonCode: "event_prescribed_load_bypass",
      bypassedByEvent: true,
      observedMassKg: "21000",
      limitMassKg: "20000",
      entityIds: [],
    });
    const partial = createSyntheticManualEvidence({
      cargoMassKg: mass("21000"),
      trailers: {
        complete: true,
        items: [pinnedEntityFact(ids.TRAILER_DISALLOWED, "trailer_type")],
      },
    });
    expect(acceptance(partial, limits, event, manualOnly)).toEqual({
      mode: "unavailable",
      exceeded: ["rule_trailer_type_disallowed"],
      blockedReasonCodes: ["event_exception_applied"],
    });
    // Without any bypass the same associated event does not prevent an override.
    expect(acceptance(partial, limits, { ...event, prescribedMassKg: "1" }, manualOnly).mode).toBe(
      "over_limits",
    );
  });
});
