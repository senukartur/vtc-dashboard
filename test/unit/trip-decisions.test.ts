import { describe, expect, test } from "vitest";
import {
  classify,
  evaluationSnapshot,
  type Historical,
} from "../../apps/api/src/modules/trip-decisions/evaluation.ts";
import {
  createSyntheticManualEvidence,
  createSyntheticTripEvidence,
  unknownFact,
} from "../fixtures/qualification-rules/fixtures.ts";

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
