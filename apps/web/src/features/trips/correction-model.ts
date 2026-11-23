// Pure model of a driver's own trip correction (VTC-169): what the author may change, the draft in
// display units and the exact TripCorrectionInput. The server still validates every rule.
import { decimalShift } from "../../shared/formatting.js";
import { referenceInstant, referenceLocalValue } from "../manual-reports/reference-time.js";
import { canonicalDecimal, type DTO } from "./transport.js";

export type CorrectionField = DTO["TripCorrectionField"];
export type CorrectionFact = DTO["TripCorrectionFact"];
export type Changes = Partial<Pick<DTO["TripCorrectionInput"], CorrectionField>>;
/** Entered values: kilometres, tonnes, wall-clock minutes in the display zone or catalog IDs. */
export type CorrectionDraft = Partial<Record<CorrectionField, string>>;
export type CorrectionError = "correctionNumber" | "correctionTime" | "correctionOrder";

/** Display order of the correctable facts, as on the trip page. */
export const correctionFields: readonly CorrectionField[] = [
  "actualDistanceM",
  "actualStartAt",
  "actualCompletedAt",
  "originCityId",
  "destinationCityId",
  "cargoId",
  "cargoMassKg",
  "trailerTypeId",
];
export const catalogKinds = {
  originCityId: "city",
  destinationCityId: "city",
  cargoId: "cargo",
  trailerTypeId: "trailer-type",
} as const satisfies Partial<Record<CorrectionField, string>>;
export type CatalogField = keyof typeof catalogKinds;
export const isCatalogField = (field: CorrectionField): field is CatalogField =>
  field in catalogKinds;
export const isTimeField = (field: CorrectionField) =>
  field === "actualStartAt" || field === "actualCompletedAt";
/** Distance in kilometres and mass in tonnes on screen; metres and kilograms on the wire. */
const places: Partial<Record<CorrectionField, number>> = { actualDistanceM: 3, cargoMassKg: 3 };

/** Lossless base-10 multiplication by 10^places of a canonical decimal. */
export function decimalScale(value: string, digits: number): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(digits, "0");
  const whole = `${integer}${padded.slice(0, digits)}`.replace(/^0+(?=\d)/, "");
  const rest = padded.slice(digits).replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}

/** The facts the author may correct now, in display order; empty without a correction state. */
export function correctableFacts(state: DTO["TripCorrectionState"] | null | undefined) {
  const facts = state?.fields ?? [];
  return correctionFields.flatMap((field) => facts.filter((fact) => fact.field === field));
}

/**
 * Facts the trip page marks "not confirmed": correctable facts of a telemetry fact revision. A
 * manual report's facts are the driver's own values, so they carry no such mark.
 */
export function unconfirmedFields(view: DTO["TripPrivate"] | null): ReadonlySet<CorrectionField> {
  if (!view || view.effectiveFacts?.provider !== "ets2telemetry") return new Set();
  return new Set(correctableFacts(view.correction).map((fact) => fact.field));
}

/** The draft starts from what the source reported, even when it is unconfirmed. */
export function initialDraft(facts: readonly CorrectionFact[], timezone: string): CorrectionDraft {
  const draft: CorrectionDraft = {};
  for (const { field, reported } of facts) {
    if (reported === null) continue;
    const shift = places[field];
    if (shift !== undefined) {
      const canonical = canonicalDecimal(reported);
      if (canonical) draft[field] = decimalShift(canonical, shift);
    } else if (isTimeField(field)) {
      const local = referenceLocalValue(reported, timezone);
      if (local) draft[field] = local;
    } else draft[field] = reported;
  }
  return draft;
}

/**
 * The changes of a draft: every correctable fact with a value, converted to wire units. Empty
 * values are omitted; invalid ones are reported per field and leave no change.
 */
export function draftChanges(
  draft: CorrectionDraft,
  facts: readonly CorrectionFact[],
  timezone: string,
): { changes: Changes; errors: Partial<Record<CorrectionField, CorrectionError>> } {
  const changes: Changes = {},
    errors: Partial<Record<CorrectionField, CorrectionError>> = {};
  for (const { field, reported } of facts) {
    const value = draft[field]?.trim();
    if (!value) continue;
    const shift = places[field];
    if (shift !== undefined) {
      const canonical = canonicalDecimal(value);
      const wire = canonical === undefined ? undefined : decimalScale(canonical, shift);
      if (!wire || wire === "0" || wire.length > 64) errors[field] = "correctionNumber";
      else changes[field] = wire;
    } else if (isTimeField(field)) {
      // An unchanged minute keeps the reported instant with its seconds.
      const instant = referenceInstant(value, timezone, reported ?? undefined);
      if (!instant) errors[field] = "correctionTime";
      else changes[field] = instant;
    } else changes[field] = value;
  }
  const start = changes.actualStartAt,
    end = changes.actualCompletedAt;
  if (start && end && Date.parse(end) < Date.parse(start)) {
    errors.actualCompletedAt = "correctionOrder";
    delete changes.actualCompletedAt;
  }
  return { changes, errors };
}

/** The exact command body; null while nothing valid is entered or the reason is missing. */
export function correctionBody(
  changes: Changes,
  reason: string,
  evidenceIds: readonly string[],
): DTO["TripCorrectionInput"] | null {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 2048 || !Object.keys(changes).length) return null;
  return { ...changes, reason: trimmed, evidenceIds: [...evidenceIds] };
}

/** A pending author correction's proposed values, by fact; empty for other proposals. */
export function proposedChanges(proposal: DTO["TripProposal"] | null | undefined): Changes {
  if (!proposal || proposal.state !== "pending" || !proposal.changes) return {};
  const changes: Changes = {};
  for (const field of correctionFields) {
    const value = proposal.changes[field];
    if (value !== undefined) changes[field] = value;
  }
  return changes;
}

/**
 * A pending proposal released before VTC-169: a text-only author request without values. Staff
 * can only decline it.
 */
export function oldFormatProposal(proposal: DTO["TripProposal"] | null | undefined) {
  return (
    !!proposal &&
    proposal.kind === "correction_request" &&
    !!proposal.correctionRequestId &&
    !proposal.changes &&
    !proposal.eventAssociation
  );
}
