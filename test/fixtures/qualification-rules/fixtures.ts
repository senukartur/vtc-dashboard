import type {
  Fact,
  NormalizedTripEvidence,
  PinnedEntity,
} from "../../../apps/api/src/modules/sources/contracts/evidence.js";
import type { EvaluationContext } from "../../../apps/api/src/modules/qualification-rules/contracts.js";
import { SYNTHETIC_IDS } from "./synthetic-rules.js";

export function knownFact<T>(
  value: T,
  field = "synthetic.field",
  recordId = "rec-synthetic-001",
): Fact<T> {
  return {
    status: "known",
    value,
    sourceField: field,
    sourceRecordId: recordId,
  };
}

export function unknownFact<T>(
  reasonCode = "data_unknown",
  recordId = "rec-synthetic-001",
): Fact<T> {
  return {
    status: "unknown",
    reasonCode,
    sourceRecordId: recordId,
  };
}

export function pinnedEntityFact(
  entityId: string,
  kind = "entity",
  field = "synthetic.pinned",
): Fact<PinnedEntity> {
  return knownFact(
    {
      entityId,
      catalogRevisionId: "cat-rev-synthetic-001",
      factRevisionId: `fact-${kind}-001`,
    },
    field,
  );
}

/**
 * Creates valid synthetic NormalizedTripEvidence representing a delivered telemetry trip.
 */
export function createSyntheticTripEvidence(
  overrides: Partial<NormalizedTripEvidence> = {},
): NormalizedTripEvidence {
  const defaultEvidence: NormalizedTripEvidence = {
    sourceRecordId: "src-record-001",
    factRevisionId: "fact-rev-001",
    provider: "ets2telemetry",
    ownerUserId: "user-synthetic-001",
    game: "ets2",
    outcome: "delivered",
    recording: "complete",
    catalogRevisionId: "cat-rev-synthetic-001",
    start: {
      utc: "2026-10-21T10:00:00.000Z",
      basis: "event",
      verifiedActual: true,
    },
    end: {
      utc: "2026-10-21T14:30:00.000Z",
      basis: "event",
      verifiedActual: true,
    },
    origin: pinnedEntityFact("00000000-0000-4000-8000-000000000010", "city", "snapshot.origin"),
    destination: pinnedEntityFact(
      "00000000-0000-4000-8000-000000000011",
      "city",
      "snapshot.destination",
    ),
    cargo: pinnedEntityFact(SYNTHETIC_IDS.CARGO_STANDARD, "cargo", "snapshot.cargo"),
    cargoMassKg: knownFact("18000", "snapshot.cargoMass"), // 18,000 kg (passes Trainee 20t)
    actualDistanceM: knownFact("450000", "snapshot.actualDistanceM"), // 450 km
    measuredSegmentM: knownFact("450000", "snapshot.measuredSegmentM"),
    plannedDistanceM: knownFact("460000", "snapshot.plannedDistanceM"),
    deliveredDistanceM: knownFact("450000", "snapshot.deliveredDistanceM"),
    fuelUsedL: knownFact("120.5", "snapshot.fuelUsedL"),
    cargoDamageFraction: knownFact("0", "snapshot.cargoDamage"),
    money: null,
    provenance: { sessionKey: "sess-001", tripKey: "trip-001" },
    wholeTripDistanceSupported: true,
    trailers: {
      complete: true,
      items: [
        pinnedEntityFact(SYNTHETIC_IDS.TRAILER_STANDARD, "trailer_type", "snapshot.trailers.0"),
      ],
    },
    adrCategory: unknownFact<PinnedEntity>("cargo_not_adr"), // non-ADR cargo
    ruleContextComplete: true,
    reasonCodes: [],
  };

  return {
    ...defaultEvidence,
    ...overrides,
  };
}

/**
 * Creates valid synthetic NormalizedTripEvidence representing a manual trip report.
 */
export function createSyntheticManualEvidence(
  overrides: Partial<NormalizedTripEvidence> = {},
): NormalizedTripEvidence {
  const defaultManual: NormalizedTripEvidence = {
    sourceRecordId: "manual-record-001",
    factRevisionId: "manual-fact-001",
    provider: "manual",
    ownerUserId: "user-synthetic-001",
    game: "ets2",
    outcome: "delivered",
    recording: "unknown",
    catalogRevisionId: "cat-rev-synthetic-001",
    start: { utc: null, basis: "unknown", verifiedActual: false },
    end: { utc: null, basis: "unknown", verifiedActual: false },
    origin: pinnedEntityFact("00000000-0000-4000-8000-000000000010", "city", "manual.originId"),
    destination: pinnedEntityFact(
      "00000000-0000-4000-8000-000000000011",
      "city",
      "manual.destinationId",
    ),
    cargo: pinnedEntityFact(SYNTHETIC_IDS.CARGO_STANDARD, "cargo", "manual.cargoId"),
    cargoMassKg: knownFact("15000", "manual.cargoMassKg"),
    actualDistanceM: knownFact("300000", "manual.actualDistanceM"),
    measuredSegmentM: unknownFact("not_supported"),
    plannedDistanceM: unknownFact("not_supported"),
    deliveredDistanceM: unknownFact("not_supported"),
    fuelUsedL: unknownFact("not_supported"),
    cargoDamageFraction: unknownFact("not_supported"),
    money: null,
    provenance: {
      reportId: "rep-001",
      revisionId: "rev-001",
      revision: 1,
      evidenceIds: ["screenshot-evidence-uuid-001"],
    },
    wholeTripDistanceSupported: false,
    trailers: {
      complete: true,
      items: [
        pinnedEntityFact(SYNTHETIC_IDS.TRAILER_STANDARD, "trailer_type", "manual.trailerTypeId"),
      ],
    },
    adrCategory: unknownFact<PinnedEntity>("cargo_not_adr"),
    ruleContextComplete: false,
    reasonCodes: ["manual_review_required", "manual_times_unknown"],
  };

  return {
    ...defaultManual,
    ...overrides,
  };
}

/**
 * Creates a synthetic EvaluationContext.
 */
export function createSyntheticEvaluationContext(
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext {
  return {
    qualificationAssignmentId: SYNTHETIC_IDS.ASSIGNMENT_ID,
    ruleVersionId: SYNTHETIC_IDS.RULE_VERSION_ID,
    attributionBasis: "actual_start",
    confirmedEvent: null,
    ...overrides,
  };
}
