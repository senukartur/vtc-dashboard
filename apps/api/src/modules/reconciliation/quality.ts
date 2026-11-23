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
const degradable = ["recording", "ruleContext", "trailers"];
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
/** Compare a manual semantic selection with a verified source variant, never two raw chains. */
export function sameTrailerContext(
  left: Evidence,
  right: Evidence,
  types: Readonly<Record<string, string>> = {},
) {
  const semantic =
    left.provider !== right.provider &&
    [left, right].some((f) =>
      f.trailers.items.some(
        (item) => item.status === "known" && item.value.identityKind === "type",
      ),
    );
  const chain = (f: Evidence) =>
    f.trailers.items.map((item) =>
      item.status !== "known"
        ? null
        : !semantic
          ? item.value.entityId
          : item.value.identityKind === "type"
            ? `type:${item.value.entityId}`
            : types[item.value.entityId]?.startsWith("type:")
              ? types[item.value.entityId]
              : `variant:${item.value.entityId}`,
    );
  return canonicalJson(chain(left)) === canonicalJson(chain(right));
}
export function selectQuality(
  facts: readonly Evidence[],
  preferredId?: string | null,
  progression?: { fromFactId: string; toFactId: string },
  trailerTypes: Readonly<Record<string, string>> = {},
) {
  const ordered = [...facts].sort((a, b) => a.factRevisionId.localeCompare(b.factRevisionId));
  let selected = ordered.find((f) => f.factRevisionId === preferredId) ?? ordered[0];
  const reasons = new Set<string>();
  for (const next of ordered) {
    if (!selected || next === selected) continue;
    const a = supported(selected),
      b = supported(next);
    // Only the owning ingestion path can prove this exact persisted open-source lineage.
    const evolving =
      progression &&
      ((selected.factRevisionId === progression.fromFactId &&
        next.factRevisionId === progression.toFactId) ||
        (next.factRevisionId === progression.fromFactId &&
          selected.factRevisionId === progression.toFactId));
    const conflicts = [...a].filter(
      (key) =>
        b.has(key) &&
        !(
          evolving &&
          ["actualDistanceM", "deliveredDistanceM", "fuelUsedL", "cargoDamageFraction"].includes(
            key,
          )
        ) &&
        (key === "trailers"
          ? !sameTrailerContext(selected as Evidence, next, trailerTypes)
          : canonicalJson(value(selected as Evidence, key)) !== canonicalJson(value(next, key))),
    );
    if (conflicts.length) {
      reasons.add("quality_supported_conflict");
      continue;
    }
    if (evolving) {
      const fromSelected = selected.factRevisionId === progression.fromFactId;
      const [older, newer] = fromSelected ? [a, b] : [b, a];
      // An open observation cannot fill a missing final cargo damage value.
      const finalDelivery = (fromSelected ? next : selected).outcome === "delivered";
      if (
        [...older].every(
          (key) =>
            newer.has(key) ||
            degradable.includes(key) ||
            (finalDelivery && key === "cargoDamageFraction"),
        )
      ) {
        if (next.factRevisionId === progression.toFactId) selected = next;
        continue;
      }
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
