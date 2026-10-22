import { canonicalJson } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence as Evidence } from "../sources/contracts/evidence.js";
const fields = [
  "origin",
  "destination",
  "cargo",
  "adrCategory",
  "cargoMassKg",
  "actualDistanceM",
  "plannedDistanceM",
  "deliveredDistanceM",
  "fuelUsedL",
  "cargoDamageFraction",
] as const;
function supported(f: Evidence) {
  return new Set([
    ...fields.filter((key) => f[key].status === "known"),
    ...(f.start.verifiedActual ? ["start"] : []),
    ...(f.end.verifiedActual ? ["end"] : []),
    ...(f.trailers.complete && f.trailers.items.every((v) => v.status === "known")
      ? ["trailers"]
      : []),
    ...(f.wholeTripDistanceSupported ? ["wholeTripDistance"] : []),
    ...(f.ruleContextComplete ? ["ruleContext"] : []),
    ...(f.recording === "complete" ? ["recording"] : []),
    ...(f.outcome !== "open" ? ["terminal"] : []),
  ]);
}
function value(f: Evidence, key: string): unknown {
  if (key === "start" || key === "end") return f[key].utc;
  if (key === "trailers")
    return f.trailers.items.map((v) => (v.status === "known" ? v.value.entityId : null));
  if (key === "terminal") return f.outcome;
  const v = f[key as (typeof fields)[number]];
  return v?.status === "known" ? (typeof v.value === "object" ? v.value.entityId : v.value) : true;
}
export function selectQuality(facts: readonly Evidence[], preferredId?: string | null) {
  const ordered = [...facts].sort((a, b) => a.factRevisionId.localeCompare(b.factRevisionId));
  let selected = ordered.find((f) => f.factRevisionId === preferredId) ?? ordered[0];
  const reasons = new Set<string>();
  for (const next of ordered) {
    if (!selected || next === selected) continue;
    const a = supported(selected),
      b = supported(next);
    const conflicts = [...a].filter(
      (key) =>
        b.has(key) &&
        canonicalJson(value(selected as Evidence, key)) !== canonicalJson(value(next, key)),
    );
    if (conflicts.length) {
      reasons.add("quality_supported_conflict");
      continue;
    }
    if ([...a].every((key) => b.has(key)) && b.size > a.size) selected = next;
    else if (![...b].every((key) => a.has(key))) reasons.add("quality_incomparable_snapshots");
  }
  // A whole coherent snapshot supplies all values; metrics and trailer/rule context are never spliced.
  return {
    selected: selected ?? null,
    reasons: [...reasons].sort(),
    provenance: selected
      ? {
          rule: "coherent-supported-snapshot/v1",
          factId: selected.factRevisionId,
          sourceRecordId: selected.sourceRecordId,
          fields: Object.fromEntries(fields.map((key) => [key, selected?.[key]])),
          start: selected.start,
          end: selected.end,
          trailers: selected.trailers,
          alternatives: ordered.map((f) => f.factRevisionId),
        }
      : null,
  };
}
