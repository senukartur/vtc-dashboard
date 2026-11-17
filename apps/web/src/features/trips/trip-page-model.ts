// Pure view model of the trip page (VTC-146 blocks, VTC-158 layout). Reads contract fields only.
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

/** The report of the current manual revision when the signed-in owner may still revise it. */
export function revisableReportId(
  view: DTO["TripView"] | undefined,
  selfId: string | undefined,
): string | null {
  const own = privateOf(view);
  if (!own || !selfId || own.summary.owner.id !== selfId) return null;
  if (own.summary.decision === "accepted") return null;
  const revision = own.manualRevision;
  return revision && "reportId" in revision ? revision.reportId : null;
}

/** Owner, a decision other than acceptance and a report-backed revision (legacy revisions cannot). */
export function canRevise(view: DTO["TripView"] | undefined, selfId: string | undefined) {
  return revisableReportId(view, selfId) !== null;
}

export type TripStatus =
  | "accepted"
  | "pending_review"
  | "needs_fix"
  | "rejected"
  | "in_progress"
  | "unassessed"
  | "cancelled";

/** One page status from the company decision and the source outcome. */
export function tripStatus(
  { decision, outcome }: Pick<Summary, "decision" | "outcome">,
  revisable: boolean,
): TripStatus {
  if (decision === "accepted") return "accepted";
  if (decision === "pending_review") return "pending_review";
  if (decision === "rejected") return revisable ? "needs_fix" : "rejected";
  if (outcome === "open") return "in_progress";
  if (outcome === "cancelled") return "cancelled";
  return "unassessed";
}

/** Decorative symbols beside the status text, so status never relies on colour alone. */
export const statusSymbol: Record<TripStatus, string | null> = {
  accepted: "✓",
  pending_review: "●",
  needs_fix: "!",
  rejected: "✕",
  in_progress: "→",
  unassessed: null,
  cancelled: "–",
};

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
  return [...new Set(codes.filter((code) => code !== "accepted_over_limits").map(reasonLabelKey))];
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

/** What the owner or staff should do next; null for other members and company summaries. */
export function nextStep(
  view: DTO["TripView"] | undefined,
  { owner, staff, revisable }: { owner: boolean; staff: boolean; revisable: boolean },
): NextStep | null {
  const own = privateOf(view);
  if (!own || (!owner && !staff)) return null;
  const status = tripStatus(own.summary, revisable);
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
      return step("next_fix", "next_fix_note", { attention: true, ...decided() });
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
 * rejected report its owner can still revise is not counted yet rather than not at all.
 */
export function creditState(
  summary: Pick<Summary, "decision" | "outcome" | "reportingAt" | "reportingBasis">,
  revisable = false,
): CreditState {
  if (summary.decision === "accepted")
    return {
      valueKey: "creditedYes",
      noteKey: summary.reportingAt ? "creditedOn" : "creditedCounted",
      at: summary.reportingAt,
      basisKey: `creditedBasis_${summary.reportingBasis ?? "unknown"}`,
    };
  if ((summary.decision === "rejected" && !revisable) || summary.outcome === "cancelled")
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
  kind: "telemetry" | "submitted" | "accepted" | "returned" | "rejected";
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
  accepted: 2,
  returned: 2,
  rejected: 2,
};

/**
 * Author-safe trip history, oldest first; at the same instant a submission precedes a decision. A
 * reviewer's rejection reads as returned for fixes only for a report-backed (revisable) revision.
 */
export function tripHistory(view: Private): HistoryEntry[] {
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
  for (const decision of view.decisions) {
    const kind =
      decision.outcome === "accepted"
        ? "accepted"
        : decision.reviewer && revision && "reportId" in revision
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
