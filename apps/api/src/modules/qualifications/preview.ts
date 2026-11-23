import type { companionComponents } from "@vtc/contracts";
import type { TxContext } from "@vtc/db";
import type { Catalogs } from "../catalogs/service.js";
import { compareDecimal } from "../sources/contracts/decimal.js";
import type { Fact, NormalizedTripEvidence, TripEntity } from "../sources/contracts/evidence.js";
import { checkTrip, type QualificationLimits, type TripCheck } from "./check.js";
import { companionRules } from "./companion.js";

type S = companionComponents["schemas"];
/** Guards describe applicability, not client-side qualification policy. */
export function previewDistanceEnvelope(
  input: S["PreviewInput"],
  limits: S["Limits"] | null,
  exempt: boolean,
) {
  const minimumDistanceM =
    input.actualDistance.support !== "unknown" ? input.actualDistance.metres : null;
  const maximumDistanceM =
    input.actualDistance.final && input.actualDistance.support === "whole-trip"
      ? input.actualDistance.metres
      : exempt ||
          (input.actualDistance.metres !== null &&
            limits?.distanceMaxM !== null &&
            limits?.distanceMaxM !== undefined &&
            compareDecimal(input.actualDistance.metres, limits.distanceMaxM) > 0)
        ? null
        : (limits?.distanceMaxM ?? null);
  return { minimumDistanceM, maximumDistanceM };
}
/** Adapt only live finality; the authoritative final checkTrip semantics remain unchanged. */
export function checkPreview(
  limits: QualificationLimits,
  facts: NormalizedTripEvidence,
  input: S["PreviewInput"],
  groups: Record<string, string>,
  exempt: boolean,
) {
  const checked = checkTrip(limits, facts, groups),
    reasons: S["Preview"]["reasons"] = [];
  for (const rule of checked.rules) {
    if (exempt) {
      rule.result = "pass";
      continue;
    }
    if (
      rule.rule === "distance" &&
      input.actualDistance.support === "partial" &&
      input.actualDistance.availability === "known" &&
      input.actualDistance.metres !== null &&
      rule.maxM !== null &&
      compareDecimal(input.actualDistance.metres, rule.maxM) > 0
    ) {
      rule.observedM = input.actualDistance.metres;
      rule.result = "fail";
    }
    if (
      rule.rule === "distance" &&
      rule.result !== "pass" &&
      input.actualDistance.support !== "whole-trip"
    )
      reasons.push("unsupported_distance");
    if (
      rule.rule === "distance" &&
      !input.actualDistance.final &&
      rule.observedM !== null &&
      rule.minM !== null &&
      compareDecimal(rule.observedM, rule.minM) < 0 &&
      (rule.maxM === null || compareDecimal(rule.observedM, rule.maxM) <= 0)
    ) {
      rule.result = "unknown";
      reasons.push("below_minimum_growing");
    }
    if (rule.rule === "hard_mode" && rule.required && !input.hardMode.final) {
      rule.result = "unknown";
      rule.observed = "unknown";
      reasons.push("hard_mode_not_final");
    }
  }
  if (checked.rules.some((rule) => rule.result === "fail")) reasons.push("limit_mismatch");
  if (
    checked.rules.some(
      (rule) => rule.result === "unknown" && (rule.rule === "cargo_damage" || !reasons.length),
    )
  )
    reasons.push("fact_unavailable");
  const outcome: TripCheck["outcome"] = exempt
    ? "pass"
    : checked.rules.some((rule) => rule.result === "fail")
      ? "fail"
      : checked.rules.some((rule) => rule.result === "unknown")
        ? "unknown"
        : "pass";
  return {
    outcome,
    rules: companionRules(checked.rules).map((rule) => ({
      ...rule,
      reasons: [
        exempt
          ? "event_attendance_exemption"
          : rule.rule === "distance" &&
              input.actualDistance.support !== "whole-trip" &&
              rule.result === "unknown"
            ? "unsupported_distance"
            : rule.rule === "distance" && reasons.includes("below_minimum_growing")
              ? "below_minimum_growing"
              : rule.rule === "hard_mode" && reasons.includes("hard_mode_not_final")
                ? "hard_mode_not_final"
                : rule.result === "fail"
                  ? "limit_mismatch"
                  : rule.result === "unknown"
                    ? "fact_unavailable"
                    : "within_limits",
      ] as S["Rule"]["reasons"],
    })),
    reasons,
  };
}
export async function previewFacts(
  tx: TxContext,
  ownerId: string,
  input: S["PreviewInput"],
  catalogs?: Pick<Catalogs, "resolveCurrentInTransaction">,
): Promise<NormalizedTripEvidence> {
  const unknown = <T>(reasonCode = "preview_unavailable"): Fact<T> => ({
    status: "unknown",
    reasonCode,
    sourceRecordId: input.requestId,
  });
  const known = <T>(value: T): Fact<T> => ({
    status: "known",
    value,
    sourceRecordId: input.requestId,
    sourceField: "companion_preview",
  });
  const entity = async (code: string | null, kind: "cargo" | "trailer") =>
    code && catalogs
      ? catalogs.resolveCurrentInTransaction(tx, { game: input.game, kind, code })
      : null;
  const cargo =
    input.cargo.availability === "known" ? await entity(input.cargo.code, "cargo") : null;
  const trailers: Fact<TripEntity>[] = [];
  for (const item of input.trailers.items) {
    const selected = item.provenance === "unknown" ? null : await entity(item.code, "trailer");
    trailers.push(selected?.status === "resolved" ? known({ entityId: selected.id }) : unknown());
  }
  return {
    sourceRecordId: input.requestId,
    factRevisionId: input.requestId,
    provider: "ets2telemetry",
    ownerUserId: ownerId,
    game: input.game,
    outcome: input.actualDistance.final ? "delivered" : "open",
    recording: "partial",
    start: {
      utc: input.start?.utc ?? null,
      basis: input.start?.basis === "actual" ? "event" : "unknown",
      verifiedActual: input.start?.basis === "actual",
    },
    end: { utc: null, basis: "unknown", verifiedActual: false },
    origin: unknown(),
    destination: unknown(),
    cargo: cargo?.status === "resolved" ? known({ entityId: cargo.id }) : unknown(),
    cargoMassKg:
      input.cargoMassKg.availability === "known" && input.cargoMassKg.value !== null
        ? known(input.cargoMassKg.value)
        : unknown(),
    actualDistanceM:
      input.actualDistance.availability === "known" &&
      input.actualDistance.metres !== null &&
      input.actualDistance.support === "whole-trip"
        ? known(input.actualDistance.metres)
        : unknown(),
    measuredSegmentM: unknown(),
    plannedDistanceM: unknown(),
    deliveredDistanceM: unknown(),
    fuelUsedL: unknown(),
    cargoDamageFraction: unknown(),
    money: null,
    provenance: null,
    wholeTripDistanceSupported: input.actualDistance.support === "whole-trip",
    trailers: { complete: input.trailers.complete, items: trailers },
    adrCategory:
      cargo?.status === "resolved"
        ? cargo.adrClass
          ? known(cargo.adrClass)
          : unknown("cargo_not_adr")
        : unknown(),
    recordedTelemetry: {
      jobType: "unknown",
      gameMode: "unknown",
      hardModeResult: input.hardMode.result,
    },
    ruleContextComplete: false,
    reasonCodes: [],
  };
}
