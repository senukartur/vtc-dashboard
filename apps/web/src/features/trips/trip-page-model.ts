// Pure view model of the trip page (VTC-146 blocks, VTC-158 layout). Reads contract fields only.
import { decimalShift, formatDecimal, type Locale } from "../../shared/formatting.js";
import { tripTranslations } from "./translations.js";
import type { DTO } from "./transport.js";

type Summary = DTO["TripSummary"];
type Private = DTO["TripPrivate"];
type Decision = DTO["Decision"];
type Facts = DTO["EffectiveTripFacts"];
type TripKey = keyof typeof tripTranslations.en;

/** Translation key ("trips" namespace) of a source's persisted outcome. */
export function sourceOutcomeKey(state: DTO["TripStage4Source"]["state"]) {
  return state === "open" ? "outcomeOpen" : state;
}

/** Cargo damage of the effective fact; unknown stays null and is never shown as zero. */
export function damageValue(facts: Facts | null | undefined): number | null {
  const value = facts?.cargoDamagePercent;
  return typeof value === "number" ? value : null;
}

/** The private view, or null for another member's summary. */
export function privateOf(view: DTO["TripView"] | undefined): Private | null {
  return view?.view === "private" ? view : null;
}

/** Extra reason code of a reviewer's "return for fixes" (VTC-169). */
export const returnedForFixesCode = "returned_for_fixes";

const reportBacked = (own: Private) => {
  const revision = own.manualRevision;
  return !!revision && "reportId" in revision;
};
/**
 * A rejection the driver may fix: a reviewer returned it for fixes, or the system rejected a
 * report-backed revision. Any other human rejection is final (VTC-169, owner decision D2).
 */
function fixableRejection(own: Private, decision: Decision | null) {
  if (!decision || decision.outcome !== "rejected") return false;
  // A legacy revision has no report to revise, so a return leaves the driver nothing to do.
  if (returnedDecision(decision)) return reportBacked(own) || !own.manualRevision;
  return !decision.reviewerId && reportBacked(own);
}
/** A reviewer's return for fixes (VTC-169), as opposed to a final or system rejection. */
export function returnedDecision(decision: Decision) {
  return (
    decision.outcome === "rejected" &&
    !!decision.reviewerId &&
    decision.reasonCodes.includes(returnedForFixesCode)
  );
}

/** The report of the current manual revision when the signed-in owner may still revise it. */
export function revisableReportId(
  view: DTO["TripView"] | undefined,
  selfId: string | undefined,
): string | null {
  const own = privateOf(view);
  if (!own || !selfId || own.summary.owner.id !== selfId) return null;
  if (own.summary.decision === "accepted") return null;
  // A final rejection leaves the driver nothing to revise.
  if (own.summary.decision === "rejected" && !awaitingFix(own)) return null;
  const revision = own.manualRevision;
  return revision && "reportId" in revision ? revision.reportId : null;
}

/** Whether the signed-in owner may open the correction page now (the server decides). */
export function canCorrect(view: DTO["TripView"] | undefined, selfId: string | undefined) {
  const own = privateOf(view);
  return !!own && !!selfId && own.summary.owner.id === selfId && !!own.correction?.canPropose;
}

/** Owner, a decision other than acceptance and a report-backed revision (legacy revisions cannot). */
export function canRevise(view: DTO["TripView"] | undefined, selfId: string | undefined) {
  return revisableReportId(view, selfId) !== null;
}

/**
 * The trip waits for its driver's fix: the latest decision is a return for fixes (or a system
 * rejection of a report). It depends on the trip data only, so every viewer reads the same
 * status, credit and history; only the owner may act on it.
 */
export function awaitingFix(view: DTO["TripView"] | undefined): boolean {
  const own = privateOf(view);
  if (own?.summary.decision !== "rejected") return false;
  return fixableRejection(own, latestDecision(own.decisions));
}

export type TripStatus =
  | "accepted"
  | "pending_review"
  | "needs_fix"
  | "rejected"
  | "in_progress"
  | "unassessed"
  | "cancelled";

/** One page status from the company decision, the source outcome and `awaitingFix`. */
export function tripStatus(
  { decision, outcome }: Pick<Summary, "decision" | "outcome">,
  fixPending: boolean,
): TripStatus {
  if (decision === "accepted") return "accepted";
  if (decision === "pending_review") return "pending_review";
  if (decision === "rejected") return fixPending ? "needs_fix" : "rejected";
  if (outcome === "open") return "in_progress";
  if (outcome === "cancelled") return "cancelled";
  return "unassessed";
}

const instant = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

/** The newest decision by its decision time, independent of the array order. */
export function latestDecision(decisions: readonly Decision[]): Decision | null {
  let latest: Decision | null = null;
  for (const decision of decisions)
    if (!latest || instant(decision.decidedAt) > instant(latest.decidedAt)) latest = decision;
  return latest;
}

/** Translation key of a reason code, or the generic label when the code has no translation. */
export function reasonLabelKey(code: string): TripKey {
  const key = `code_${code}`;
  return key in tripTranslations.en ? (key as TripKey) : "reasonOther";
}

/** Labels of reason codes without duplicates; the over-limits code is shown by its own marker. */
export function reasonLabelKeys(codes: readonly string[]): TripKey[] {
  return [
    ...new Set(
      codes
        .filter((code) => code !== "accepted_over_limits" && code !== returnedForFixesCode)
        .map(reasonLabelKey),
    ),
  ];
}

export type NextStep = {
  titleKey: TripKey;
  noteKey: TripKey;
  /** The driver must act. */
  attention: boolean;
  /** Reviewer of the latest decision; null for a system decision or when not applicable. */
  reviewer: string | null;
  reason: string | null;
  reasonKeys: TripKey[];
  /** The reasons explain why the trip is held for review rather than a decision. */
  held: boolean;
};

/**
 * What the owner or staff should do next; null for other members and company summaries. A trip
 * awaiting a fix asks the owner to act and tells staff it waits for the driver.
 */
export function nextStep(
  view: DTO["TripView"] | undefined,
  { owner, staff }: { owner: boolean; staff: boolean },
): NextStep | null {
  const own = privateOf(view);
  if (!own || (!owner && !staff)) return null;
  const status = tripStatus(own.summary, awaitingFix(own));
  const step = (
    titleKey: TripKey,
    noteKey: TripKey,
    extra: Partial<Omit<NextStep, "titleKey" | "noteKey">> = {},
  ): NextStep => ({
    titleKey,
    noteKey,
    attention: false,
    reviewer: null,
    reason: null,
    reasonKeys: [],
    held: false,
    ...extra,
  });
  const decided = () => {
    const latest = latestDecision(own.decisions);
    return {
      reviewer: latest?.reviewer?.nickname ?? null,
      reason: latest?.reason ?? null,
      reasonKeys: reasonLabelKeys(latest?.reasonCodes ?? []),
    };
  };
  if (own.pendingProposalId) return step("next_correction", "next_correction_note");
  switch (status) {
    case "needs_fix":
      return owner
        ? step("next_fix", reportBacked(own) ? "next_fix_note" : "next_fix_telemetry_note", {
            attention: true,
            ...decided(),
          })
        : step("next_fix_staff", "next_fix_staff_note", decided());
    case "pending_review":
      return staff && !owner
        ? step("next_pending_staff", "next_pending_staff_note", {
            reasonKeys: reasonLabelKeys(own.reviewReasonCodes),
            held: true,
          })
        : step("next_none", "next_pending_note", {
            reasonKeys: reasonLabelKeys(own.reviewReasonCodes),
            held: true,
          });
    case "accepted":
      return step("next_none", "next_accepted_note");
    case "rejected":
      return step("next_rejected", "next_rejected_note", decided());
    case "in_progress":
      return step("next_open", "next_open_note");
    case "cancelled":
      return step("next_cancelled", "next_cancelled_note");
    default:
      return step("next_unassessed", "next_unassessed_note");
  }
}

export type CreditState = {
  valueKey: TripKey;
  noteKey: TripKey;
  /** Reporting instant of an accepted trip, for the note. */
  at: string | null;
  /** Explanation of the reporting basis, only for an accepted trip. */
  basisKey: TripKey | null;
};

/**
 * Whether the trip counts in company totals; the reporting time replaces a raw "instant" chip. A
 * rejected report awaiting its driver's fix (`awaitingFix`) is not counted yet rather than not at all.
 */
export function creditState(
  summary: Pick<Summary, "decision" | "outcome" | "reportingAt" | "reportingBasis">,
  fixPending = false,
): CreditState {
  if (summary.decision === "accepted")
    return {
      valueKey: "creditedYes",
      noteKey: summary.reportingAt ? "creditedOn" : "creditedCounted",
      at: summary.reportingAt,
      basisKey: `creditedBasis_${summary.reportingBasis ?? "unknown"}`,
    };
  if ((summary.decision === "rejected" && !fixPending) || summary.outcome === "cancelled")
    return { valueKey: "creditedNo", noteKey: "creditedRejectedNote", at: null, basisKey: null };
  return {
    valueKey: "creditedNotYet",
    noteKey: "creditedAfterAcceptance",
    at: null,
    basisKey: null,
  };
}

export type DistanceNote = {
  /** Exact metres, or null when unknown (never zero). */
  value: string | null;
  sourceKey: "distanceByTelemetry" | "distanceByReport" | null;
  noTelemetry: boolean;
};

/** Where the trip distance comes from and whether telemetry is missing. */
export function distanceNote(
  summary: Pick<Summary, "actualDistanceM" | "sourceKinds">,
  facts: Facts | null | undefined,
): DistanceNote {
  return {
    value: summary.actualDistanceM,
    sourceKey:
      summary.actualDistanceM === null || !facts
        ? null
        : facts.provider === "ets2telemetry"
          ? "distanceByTelemetry"
          : "distanceByReport",
    noTelemetry: !summary.sourceKinds.includes("ets2telemetry"),
  };
}

export type TripTimes = { startedAt: string | null; completedAt: string | null; reported: boolean };

/** Actual times of the effective fact, else the reference times of the report, else none. */
export function tripTimes(
  facts: Facts | null | undefined,
  revision: DTO["ManualRevisionRead"] | null | undefined,
): TripTimes | null {
  if (facts && (facts.actualStartAt || facts.actualCompletedAt))
    return {
      startedAt: facts.actualStartAt,
      completedAt: facts.actualCompletedAt,
      reported: false,
    };
  if (revision && "representation" in revision) {
    const { startedAt, completedAt } = revision.fields;
    if (startedAt || completedAt)
      return { startedAt: startedAt ?? null, completedAt: completedAt ?? null, reported: true };
  }
  return null;
}

export type TripDamage = { value: number; reported: boolean };

/**
 * Cargo damage of the effective fact. The report's damage stands in, marked as reported, only when
 * there is no effective fact or it carries no damage field: an explicit null from the server means
 * unknown and stays null, because the server already applies the manual value when that fact wins.
 */
export function reportedDamage(
  facts: Facts | null | undefined,
  revision: DTO["ManualRevisionRead"] | null | undefined,
): TripDamage | null {
  if (facts && "cargoDamagePercent" in facts) {
    const effective = damageValue(facts);
    return effective === null ? null : { value: effective, reported: false };
  }
  const reported =
    revision && "representation" in revision ? revision.fields.cargoDamagePercent : undefined;
  return typeof reported === "number" ? { value: reported, reported: true } : null;
}

/** Why a recorded value is unknown: the trip has no telemetry at all, or telemetry missed it. */
export function unknownHintKey(summary: Pick<Summary, "sourceKinds">): TripKey {
  return summary.sourceKinds.includes("ets2telemetry")
    ? "unknownHelpTelemetry"
    : "unknownHelpNoTelemetry";
}

export type CargoLabel =
  | "adr"
  | "adrUnsupported"
  | "valuable"
  | "overweight"
  | DTO["TripCargoClassification"]["groups"][number];

/**
 * Cargo labels the telemetry client reported, in display order: ADR, the flags, then the other
 * groups. The fragile and oversize groups merge into their flags; no report gives no labels.
 */
export function cargoLabels(
  classification: DTO["TripCargoClassification"] | undefined,
): { label: CargoLabel; adrClass?: number }[] {
  if (!classification) return [];
  const { adr, groups } = classification,
    labels: { label: CargoLabel; adrClass?: number }[] = [];
  if (adr.state === "class") labels.push({ label: "adr", adrClass: adr.class });
  if (adr.state === "unsupported") labels.push({ label: "adrUnsupported" });
  if (classification.fragile || groups.includes("fragile")) labels.push({ label: "fragile" });
  if (classification.valuable) labels.push({ label: "valuable" });
  if (classification.overweight) labels.push({ label: "overweight" });
  if (classification.oversize || groups.includes("oversize")) labels.push({ label: "oversize" });
  for (const group of groups)
    if (group !== "fragile" && group !== "oversize") labels.push({ label: group });
  return labels;
}

/** Translation key of a recorded game mode, job type or Hard Mode result; null when unknown. */
export function recordedValueKey(
  category: "telemetryMode" | "telemetryJob" | "telemetryAudit",
  value: string | null | undefined,
): TripKey | null {
  if (!value || value === "unknown") return null;
  const key = `${category}_${value}`;
  return key in tripTranslations.en ? (key as TripKey) : null;
}

export type HistoryEntry = {
  id: string;
  kind:
    | "telemetry"
    | "submitted"
    | "proposed"
    | "correction_approved"
    | "correction_declined"
    | "accepted"
    | "returned"
    | "rejected";
  titleKey: TripKey;
  /** Revision number for a later submission. */
  number: number | null;
  at: string;
  /** Member nickname; null with `system` for a system decision, null otherwise for no actor. */
  actor: string | null;
  system: boolean;
  quote: string | null;
  reasonKeys: TripKey[];
  overLimits: boolean;
};

const rank: Record<HistoryEntry["kind"], number> = {
  telemetry: 0,
  submitted: 1,
  proposed: 1,
  correction_approved: 2,
  correction_declined: 2,
  accepted: 3,
  returned: 3,
  rejected: 3,
};

/**
 * Author-safe trip history, oldest first; at the same instant a submission precedes a decision. A
 * rejection reads as returned for fixes when the driver may fix it; the driver's own corrections
 * (proposals with values) read as proposed corrections, and a reviewed one also as accepted or
 * declined with the reviewer's comment.
 */
export function tripHistory(
  view: Private,
  proposals: readonly DTO["TripProposal"][] = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const telemetry = view.sources?.find((source) => source.kind === "ets2telemetry");
  if (telemetry)
    entries.push({
      id: "telemetry",
      kind: "telemetry",
      titleKey: "history_telemetry",
      number: null,
      at: telemetry.receivedAt,
      actor: null,
      system: false,
      quote: null,
      reasonKeys: [],
      overLimits: false,
    });
  const revision = view.manualRevision;
  if (revision)
    entries.push({
      id: revision.id,
      kind: "submitted",
      titleKey: revision.number > 1 ? "revisionSubmitted" : "history_submitted",
      number: revision.number > 1 ? revision.number : null,
      at: revision.submittedAt,
      actor: view.summary.owner.nickname,
      system: false,
      quote: null,
      reasonKeys: [],
      overLimits: false,
    });
  for (const proposal of proposals) {
    if (!proposal.changes || proposal.authorId !== view.summary.owner.id) continue;
    entries.push({
      id: proposal.id,
      kind: "proposed",
      titleKey: "history_proposed",
      number: null,
      at: proposal.createdAt,
      actor: view.summary.owner.nickname,
      system: false,
      quote: proposal.reason,
      reasonKeys: [],
      overLimits: false,
    });
    const review = proposal.state === "pending" ? null : proposal.review;
    if (review) {
      const kind = review.decision === "approve" ? "correction_approved" : "correction_declined";
      entries.push({
        id: `${proposal.id}-review`,
        kind,
        titleKey: `history_${kind}`,
        number: null,
        at: review.decidedAt,
        // The proposal read names no reviewer; the decision entry beside it does.
        actor: null,
        system: false,
        quote: review.reason,
        reasonKeys: [],
        overLimits: false,
      });
    }
  }
  for (const decision of view.decisions) {
    const kind =
      decision.outcome === "accepted"
        ? "accepted"
        : returnedDecision(decision) && fixableRejection(view, decision)
          ? "returned"
          : "rejected";
    entries.push({
      id: decision.id,
      kind,
      titleKey: `history_${kind}`,
      number: null,
      at: decision.decidedAt,
      actor: decision.reviewer?.nickname ?? null,
      system: !decision.reviewer,
      quote: decision.reason,
      reasonKeys: reasonLabelKeys(decision.reasonCodes),
      overLimits: decision.acceptedOverLimits,
    });
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        instant(a.entry.at) - instant(b.entry.at) ||
        rank[a.entry.kind] - rank[b.entry.kind] ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

// Summary-first trip page (VTC-170): rounded quantities, the status banner, the accepted line,
// the collapsed qualification check, route duration and the event-link dialog.

/** A display-only rounded quantity: whole kilometres or tenths of a tonne. */
export type RoundedQuantity = { value: string; lessThan: boolean };

/** Half-up rounding of a canonical non-negative decimal string to `places` fraction digits. */
function roundHalfUp(value: string, places: number): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const kept = BigInt(`${whole}${fraction.padEnd(places, "0").slice(0, places)}`);
  const next = fraction[places];
  const digits = (kept + (next !== undefined && next >= "5" ? 1n : 0n))
    .toString()
    .padStart(places + 1, "0");
  const integer = places ? digits.slice(0, -places) : digits;
  const decimals = places ? digits.slice(-places).replace(/0+$/, "") : "";
  return decimals ? `${integer}.${decimals}` : integer;
}

/**
 * Metres to whole kilometres or kilograms to tenths of a tonne, half up, without passing through
 * Number. A positive value that rounds to zero reads as "less than" the smallest step; an exact
 * zero stays zero and unknown stays null.
 */
export function roundedQuantity(value: string | null, unit: "km" | "t"): RoundedQuantity | null {
  if (value === null) return null;
  const shifted = decimalShift(value, 3);
  const rounded = roundHalfUp(shifted, unit === "km" ? 0 : 1);
  if (rounded === "0" && /[1-9]/.test(shifted))
    return { value: unit === "km" ? "1" : "0.1", lessThan: true };
  return { value: rounded, lessThan: false };
}

/** "251 km", "24,9 т" or "< 1 km" of an already rounded quantity. */
export function formatRoundedQuantity(rounded: RoundedQuantity, unit: "km" | "t", locale: Locale) {
  const name = unit === "km" ? (locale === "ru" ? "км" : "km") : locale === "ru" ? "т" : "t";
  return `${rounded.lessThan ? "< " : ""}${formatDecimal(rounded.value, locale)} ${name}`;
}

/** Metres or kilograms as "251 km", "24,9 т" or "< 1 km"; null when unknown. */
export function formatRounded(value: string | null, unit: "km" | "t", locale: Locale) {
  const rounded = roundedQuantity(value, unit);
  return rounded ? formatRoundedQuantity(rounded, unit, locale) : null;
}

export type TripBanner = {
  status: Exclude<TripStatus, "accepted">;
  tone: "warn" | "pending" | "error" | "neutral";
  /** Whether the trip may still count ("not counted yet") or will not ("not counted"). */
  counted: "notYet" | "no";
  /** One sentence on what happens next. */
  noteKey: TripKey;
  /** The latest decision's reviewer comment. */
  quote: string | null;
  /** Translated reason labels of the latest decision. */
  reasonKeys: TripKey[];
  /** Why a pending trip is held, shown behind an info button. */
  heldKeys: TripKey[];
  /** Reviewer nickname of the latest decision; null for a system decision or none. */
  actor: string | null;
  system: boolean;
  /** The decision time, or the submission time of a pending report. */
  at: string | null;
  /** The owner can fix a returned report. */
  action: "fix" | null;
};

const bannerNoteKey: Record<TripBanner["status"], TripKey> = {
  pending_review: "next_pending_note",
  needs_fix: "next_fix_staff_note",
  rejected: "next_rejected_note",
  in_progress: "next_open_note",
  unassessed: "next_unassessed_note",
  cancelled: "next_cancelled_note",
};

/**
 * The one status banner of a trip that is not accepted; null for an accepted trip, which shows only
 * its badge and the counted line. Built on `tripStatus`, `awaitingFix` and `nextStep`, so the owner
 * and staff read the same status while only the owner gets the fix action.
 */
export function tripBanner(
  view: DTO["TripView"] | undefined,
  { owner, staff }: { owner: boolean; staff: boolean },
): TripBanner | null {
  if (!view) return null;
  const own = privateOf(view),
    summary = own ? own.summary : (view as Summary),
    fixPending = awaitingFix(view),
    status = tripStatus(summary, fixPending);
  if (status === "accepted") return null;
  const next = nextStep(view, { owner, staff }),
    decided = status === "needs_fix" || status === "rejected",
    latest = own && decided ? latestDecision(own.decisions) : null,
    credit = creditState(summary, fixPending);
  return {
    status,
    tone:
      status === "needs_fix"
        ? "warn"
        : status === "pending_review"
          ? "pending"
          : status === "rejected"
            ? "error"
            : "neutral",
    counted: credit.valueKey === "creditedNo" ? "no" : "notYet",
    noteKey: next?.noteKey ?? bannerNoteKey[status],
    quote: next?.reason ?? null,
    reasonKeys: next && !next.held ? next.reasonKeys : [],
    heldKeys: next?.held ? next.reasonKeys : [],
    actor: latest?.reviewer?.nickname ?? null,
    system: !!latest && !latest.reviewer,
    at: latest
      ? latest.decidedAt
      : status === "pending_review"
        ? (summary.submittedAt ?? null)
        : null,
    action: owner && status === "needs_fix" ? "fix" : null,
  };
}

export type AcceptedLine = {
  /** Rounded distance, or null when unknown. */
  distance: RoundedQuantity | null;
  game: Summary["game"];
  /** Reviewer of the latest acceptance; null for a system decision or a company summary. */
  actor: string | null;
  system: boolean;
  at: string | null;
};

/**
 * The single "Counted" line of an accepted trip: distance, game and, in a private view, who
 * accepted it and when. Null for any other status.
 */
export function acceptedLine(view: DTO["TripView"] | undefined): AcceptedLine | null {
  if (!view) return null;
  const own = privateOf(view),
    summary = own ? own.summary : (view as Summary);
  if (summary.decision !== "accepted") return null;
  const latest = own
    ? latestDecision(own.decisions.filter((decision) => decision.outcome === "accepted"))
    : null;
  return {
    distance: roundedQuantity(summary.actualDistanceM, "km"),
    game: summary.game,
    actor: latest?.reviewer?.nickname ?? null,
    system: !!latest && !latest.reviewer,
    at: latest?.decidedAt ?? null,
  };
}

/** Passed and total limits of a check with its tone; null without a check or rules. */
export function qualificationSummary(check: DTO["QualificationCheck"] | null | undefined) {
  if (!check?.rules.length) return null;
  const passed = check.rules.filter((rule) => rule.result === "pass").length,
    failed = check.rules.some((rule) => rule.result === "fail");
  const tone: "ok" | "warn" | "error" = failed
    ? "error"
    : passed === check.rules.length
      ? "ok"
      : "warn";
  return { passed, total: check.rules.length, tone };
}

/** Whole minutes between start and completion; null unless both are known and in order. */
export function tripDuration(times: TripTimes | null | undefined): number | null {
  if (!times?.startedAt || !times.completedAt) return null;
  const start = Date.parse(times.startedAt),
    end = Date.parse(times.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

/** The calendar day ("YYYY-MM-DD") of an instant in a time zone; null when unreadable. */
export function localDay(value: string, timeZone: string): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(time);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return null;
  }
}

/**
 * The local days the trip covered in the display zone, from its start to its completion (either
 * alone when the other is unknown), at most 31; null without times.
 */
export function tripDays(times: TripTimes | null | undefined, timeZone: string): string[] | null {
  const ends = [times?.startedAt, times?.completedAt]
    .filter((value): value is string => !!value)
    .map((value) => localDay(value, timeZone))
    .filter((day): day is string => day !== null)
    .sort();
  const first = ends[0],
    last = ends.at(-1);
  if (!first || !last) return null;
  const days: string[] = [];
  // Calendar arithmetic on the date alone, independent of the display zone.
  for (let day = Date.parse(`${first}T00:00:00Z`); days.length < 31; day += 86400000) {
    const text = new Date(day).toISOString().slice(0, 10);
    days.push(text);
    if (text >= last) break;
  }
  return days;
}

type EventItem = DTO["EventPublic"];

/** Events a trip can link to: the same game and still scheduled, newest first. */
export function eventCandidates(items: readonly EventItem[], game: Summary["game"]) {
  return items
    .filter((event) => event.game === game && event.status === "scheduled")
    .map((event, index) => ({ event, index }))
    .sort((a, b) => instant(b.event.startsAt) - instant(a.event.startsAt) || b.index - a.index)
    .map(({ event }) => event);
}

/** The event starts on one of the trip's local days. */
export function onTripDays(event: EventItem, days: readonly string[], timeZone: string) {
  const day = localDay(event.startsAt, timeZone);
  return day !== null && days.includes(day);
}

/** The event's origin and destination are the trip's, compared by canonical ID. */
export function routeMatches(
  event: Pick<EventItem, "origin" | "destination">,
  summary: Pick<Summary, "origin" | "destination">,
) {
  return (
    !!event.origin &&
    !!event.destination &&
    !!summary.origin &&
    !!summary.destination &&
    event.origin.entityId === summary.origin.entityId &&
    event.destination.entityId === summary.destination.entityId
  );
}

/**
 * What linking does, following the server: a decided trip gets a proposal for staff while its
 * result stays; any other trip is linked at once and checked again. Attendance decides only
 * whether the event's exception to the level limits can apply; a signup is not attendance.
 */
export function associationConsequence(
  decision: Summary["decision"],
  member: Pick<DTO["EventMember"], "myAttendance" | "myResponse"> | null | undefined,
): { linkKey: TripKey; attendanceKey: TripKey | null } {
  const linkKey: TripKey =
    decision === "accepted" || decision === "rejected" ? "eventLinkReviewed" : "eventLinkImmediate";
  if (!member) return { linkKey, attendanceKey: null };
  return {
    linkKey,
    attendanceKey:
      member.myAttendance === "attended"
        ? "eventAttended"
        : member.myAttendance === "not_attended"
          ? "eventNotAttended"
          : member.myResponse.response === "participating"
            ? "eventSignedUp"
            : "eventNotSignedUp",
  };
}
