import { compareDecimal } from "../sources/contracts/decimal.js";
import type { AdrClass, NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import type { QualificationProgressTotals } from "../trips/contributions.js";

export type { QualificationProgressTotals };

export type RuleResult = "pass" | "fail" | "unknown";
export const adrClasses = ["1", "2", "3", "4", "6", "8"] as const;

/** Trip limits of one level. Null bounds and the any modes are unset limits. */
export interface QualificationLimits {
  readonly massMinKg: string | null;
  readonly massMaxKg: string | null;
  readonly distanceMinM: string | null;
  readonly distanceMaxM: string | null;
  readonly trailers: {
    readonly basis?: "variant" | "type";
    readonly mode: "any" | "selected";
    readonly typeIds: readonly string[];
  };
  readonly adr: {
    readonly mode: "forbidden" | "selected" | "any";
    readonly classes: readonly AdrClass[];
  };
  readonly hardModeRequired: boolean;
}

/** Promotion conditions of one level; every set condition must be met. */
export interface QualificationConditions {
  readonly requiredTrips: number | null;
  readonly requiredDistanceM: string | null;
}

export type CheckedRule =
  | {
      rule: "cargo_mass";
      result: RuleResult;
      minKg: string | null;
      maxKg: string | null;
      observedKg: string | null;
    }
  | {
      rule: "distance";
      result: RuleResult;
      minM: string | null;
      maxM: string | null;
      observedM: string | null;
    }
  | {
      rule: "trailer_types";
      result: RuleResult;
      mode: "any" | "selected";
      allowedIds: string[];
      observedIds: string[];
    }
  | {
      rule: "adr";
      result: RuleResult;
      mode: "forbidden" | "selected" | "any";
      allowedClasses: AdrClass[];
      observed: AdrClass | "none" | null;
    }
  | {
      rule: "hard_mode";
      result: RuleResult;
      required: boolean;
      observed: "qualified" | "not-qualified" | "unknown" | null;
    };

export interface TripCheck {
  readonly outcome: RuleResult;
  readonly rules: CheckedRule[];
}

/** The check stored with a trip decision so later ladder edits never rewrite history. */
export interface QualificationSnapshot {
  /** Exact group identities used for this check; retained with the immutable decision. */
  readonly trailerGroups?: Readonly<Record<string, string>>;
  readonly levelId: string | null;
  readonly levelName: string | null;
  readonly editVersion: number | null;
  readonly limits: QualificationLimits | null;
  readonly eventExempt: boolean;
  /** New exempt decisions retain observations without changing the existing browser exemption view. */
  readonly exemptionRules?: CheckedRule[];
  readonly outcome: RuleResult | null;
  readonly reasonCode: string | null;
  readonly rules: CheckedRule[];
}

/** Decision reason codes of failed limits; staff may accept any of them over the limits. */
export const QUALIFICATION_REASONS = {
  cargo_mass: "qualification_cargo_mass",
  distance: "qualification_distance",
  trailer_types: "qualification_trailer",
  adr: "qualification_adr",
  hard_mode: "qualification_hard_mode",
} as const satisfies Record<CheckedRule["rule"], string>;
export const QUALIFICATION_UNKNOWN = "qualification_unknown";
export const NO_LEVEL = "qualification_level_unknown";
export const ATTRIBUTION_UNKNOWN = "qualification_attribution_time_unknown";

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const known = (value: string | null) => (value !== null && DECIMAL.test(value) ? value : null);

function range(min: string | null, max: string | null, observed: string | null): RuleResult {
  if (min === null && max === null) return "pass";
  if (observed === null) return "unknown";
  if (min !== null && compareDecimal(observed, min) < 0) return "fail";
  if (max !== null && compareDecimal(observed, max) > 0) return "fail";
  return "pass";
}

/**
 * The single qualification check of one trip against one level's limits. Bounds are inclusive,
 * unknown facts are never a violation, and any failure outranks any unknown rule.
 */
export function checkTrip(
  limits: QualificationLimits,
  facts: NormalizedTripEvidence,
  trailerGroups: Readonly<Record<string, string>> = {},
): TripCheck {
  const mass = known(facts.cargoMassKg.status === "known" ? facts.cargoMassKg.value : null);
  const distance = known(
    facts.actualDistanceM.status === "known" ? facts.actualDistanceM.value : null,
  );
  const observedTrailers = [
    ...new Set(
      facts.trailers.items.flatMap((item) =>
        item.status === "known" ? [item.value.entityId] : [],
      ),
    ),
  ].sort();
  let trailers: RuleResult = "pass";
  if (limits.trailers.mode === "selected") {
    const identity = (id: string) => trailerGroups[id] ?? id;
    const allowed = new Set(limits.trailers.typeIds.map(identity));
    const unclassified = (id: string) =>
      limits.trailers.basis === "type" && (!trailerGroups[id] || trailerGroups[id] === "undefined");
    const typeAgainstVariant = new Set(
      limits.trailers.basis === "type"
        ? []
        : facts.trailers.items.flatMap((item) =>
            item.status === "known" && item.value.identityKind === "type"
              ? [item.value.entityId]
              : [],
          ),
    );
    if (
      observedTrailers.some(
        (id) => !unclassified(id) && !typeAgainstVariant.has(id) && !allowed.has(identity(id)),
      )
    )
      trailers = "fail";
    else if (
      observedTrailers.some(unclassified) ||
      typeAgainstVariant.size > 0 ||
      !facts.trailers.complete ||
      !facts.trailers.items.length ||
      facts.trailers.items.some((item) => item.status !== "known")
    )
      trailers = "unknown";
  }
  const adrFact = facts.adrCategory;
  const observedAdr: AdrClass | "none" | null =
    adrFact.status === "known"
      ? adrFact.value
      : adrFact.reasonCode === "cargo_not_adr"
        ? "none"
        : null;
  let adr: RuleResult = "pass";
  if (limits.adr.mode !== "any") {
    if (observedAdr === null) adr = "unknown";
    else if (observedAdr === "none") adr = "pass";
    else if (limits.adr.mode === "forbidden") adr = "fail";
    else adr = limits.adr.classes.includes(observedAdr) ? "pass" : "fail";
  }
  const hardModeObserved = facts.recordedTelemetry?.hardModeResult ?? null;
  const hardMode: RuleResult = !limits.hardModeRequired
    ? "pass"
    : hardModeObserved === "qualified"
      ? "pass"
      : hardModeObserved === "not-qualified"
        ? "fail"
        : "unknown";
  const rules: CheckedRule[] = [
    {
      rule: "cargo_mass",
      result: range(limits.massMinKg, limits.massMaxKg, mass),
      minKg: limits.massMinKg,
      maxKg: limits.massMaxKg,
      observedKg: mass,
    },
    {
      rule: "distance",
      result: range(limits.distanceMinM, limits.distanceMaxM, distance),
      minM: limits.distanceMinM,
      maxM: limits.distanceMaxM,
      observedM: distance,
    },
    {
      rule: "trailer_types",
      result: trailers,
      mode: limits.trailers.mode,
      allowedIds: limits.trailers.mode === "selected" ? [...limits.trailers.typeIds].sort() : [],
      observedIds: observedTrailers.slice(0, 10),
    },
    {
      rule: "adr",
      result: adr,
      mode: limits.adr.mode,
      allowedClasses: limits.adr.mode === "selected" ? [...limits.adr.classes].sort() : [],
      observed: observedAdr,
    },
    {
      rule: "hard_mode",
      result: hardMode,
      required: limits.hardModeRequired,
      observed: hardModeObserved,
    },
  ];
  const outcome: RuleResult = rules.some((r) => r.result === "fail")
    ? "fail"
    : rules.some((r) => r.result === "unknown")
      ? "unknown"
      : "pass";
  return { outcome, rules };
}

/** Whether totals meet every set condition; a level without conditions never promotes. */
export function conditionsMet(
  conditions: QualificationConditions,
  totals: QualificationProgressTotals,
): boolean {
  if (conditions.requiredTrips === null && conditions.requiredDistanceM === null) return false;
  if (conditions.requiredTrips !== null && totals.completedTrips < conditions.requiredTrips)
    return false;
  if (
    conditions.requiredDistanceM !== null &&
    compareDecimal(totals.completedDistanceM, conditions.requiredDistanceM) < 0
  )
    return false;
  return true;
}
