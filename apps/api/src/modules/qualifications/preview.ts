import type { components } from "@vtc/contracts";
import { decimal38_18 } from "@vtc/db";
import { identityError } from "../identity/service.js";
import { defaultRegistry, evaluateQualificationRules } from "../qualification-rules/index.js";
import type { Fact, NormalizedTripEvidence, PinnedEntity } from "../sources/contracts/evidence.js";

type S = components["schemas"];
export function validateDraftRules(input: readonly S["Rule"][]) {
  try {
    const rules = defaultRegistry.validateRuleSet(input);
    if (rules.length > 32 || new Set(rules.map((r) => r.type)).size !== rules.length)
      throw new Error();
    for (const rule of input) {
      if (rule.type === "max_mass") decimal38_18(rule.maxKg);
      else if (
        rule.entityIds.length > 1000 ||
        new Set(rule.entityIds).size !== rule.entityIds.length
      )
        throw new Error();
    }
    return rules;
  } catch {
    throw identityError(422);
  }
}
const reasons = new Set([
  "rule_passed",
  "rule_mass_exceeded",
  "rule_mass_unknown",
  "rule_mass_invalid",
  "rule_trailer_type_disallowed",
  "rule_trailer_type_unknown",
  "rule_trailers_incomplete",
  "rule_adr_category_disallowed",
  "rule_adr_category_unknown",
]);

/** Hypothetical facts have no owner, source acceptance or confirmed-event authority. */
export function previewRules(input: S["QualificationPreviewInput"]): S["QualificationPreview"] {
  const rules = validateDraftRules(input.rules),
    sample = input.sample;
  try {
    if (sample.cargoMassKg !== null) decimal38_18(sample.cargoMassKg);
    if ((sample.adr.status === "known") !== (sample.adr.entityId !== null)) throw new Error();
  } catch {
    throw identityError(422);
  }
  const marker = "00000000-0000-4000-8000-000000000001";
  const unknown = <T>(reasonCode = "hypothetical_unknown"): Fact<T> => ({
    status: "unknown",
    reasonCode,
    sourceRecordId: marker,
  });
  const known = <T>(value: T): Fact<T> => ({
    status: "known",
    value,
    sourceRecordId: marker,
    sourceField: "hypothetical",
  });
  const pin = (entityId: string): PinnedEntity => ({
    entityId,
    catalogRevisionId: marker,
    factRevisionId: marker,
  });
  const evidence: NormalizedTripEvidence = {
    sourceRecordId: marker,
    factRevisionId: marker,
    ownerUserId: marker,
    provider: "manual",
    game: input.game,
    outcome: "none",
    recording: "unknown",
    catalogRevisionId: null,
    start: { utc: null, basis: "unknown", verifiedActual: false },
    end: { utc: null, basis: "unknown", verifiedActual: false },
    origin: unknown(),
    destination: unknown(),
    cargo: unknown(),
    cargoMassKg: sample.cargoMassKg === null ? unknown() : known(sample.cargoMassKg),
    actualDistanceM: unknown(),
    measuredSegmentM: unknown(),
    plannedDistanceM: unknown(),
    deliveredDistanceM: unknown(),
    fuelUsedL: unknown(),
    cargoDamageFraction: unknown(),
    money: null,
    provenance: null,
    wholeTripDistanceSupported: false,
    trailers: {
      complete: sample.trailersComplete,
      items: sample.trailerTypeIds.map((id) => (id === null ? unknown() : known(pin(id)))),
    },
    adrCategory:
      sample.adr.status === "known" && sample.adr.entityId
        ? known(pin(sample.adr.entityId))
        : unknown(sample.adr.status === "non_hazardous" ? "cargo_not_adr" : "hypothetical_unknown"),
    ruleContextComplete: false,
    reasonCodes: [],
  };
  const result = evaluateQualificationRules(evidence, rules);
  return {
    outcome: result.outcome,
    ruleResults: result.ruleResults.map((r) => {
      if (
        !reasons.has(r.reasonCode) ||
        !["max_mass", "allowed_trailer_types", "allowed_adr_categories"].includes(r.ruleType)
      )
        throw new Error("UNSUPPORTED_PREVIEW_RESULT");
      return {
        ruleType: r.ruleType as S["QualificationPreview"]["ruleResults"][number]["ruleType"],
        outcome: r.outcome,
        reasonCode: r.reasonCode as S["QualificationPreview"]["ruleResults"][number]["reasonCode"],
      };
    }),
  };
}
