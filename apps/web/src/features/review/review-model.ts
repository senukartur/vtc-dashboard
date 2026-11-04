import { type DTO, revisionFields } from "../trips/transport.js";

/** Pure view model of the dispatch review queue and decision panel (VTC-059). */
export type QueueTab = "awaiting" | "decided";
export type QueueOrder = "asc" | "desc";
export type QueueGame = "ets2" | "ats";
export type QueueDecision = DTO["TripSummary"]["decision"];
export type QueueParams = {
  tab: QueueTab;
  game: QueueGame | undefined;
  decision: QueueDecision | undefined;
  order: QueueOrder;
  trip: string | null;
};
export type QueueType = "late_telemetry" | "resubmission" | "manual" | "telemetry";
export type RuleFlag = "exceeded" | "check" | "none";
export type Choice = "accept" | "reject";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const decisions: readonly QueueDecision[] = [
  "unassessed",
  "pending_review",
  "accepted",
  "rejected",
];
/** Qualification limits a reviewer may waive with explicit confirmation (policy, VTC-059A). */
export const overLimitCodes: ReadonlySet<string> = new Set([
  "rule_mass_exceeded",
  "rule_trailer_type_disallowed",
  "rule_adr_category_disallowed",
]);
export const lateTelemetryCode = "confirmed_facts_require_review";
export const selfReviewCode = "self_review_forbidden";
export const reasonLimit = 2048;
export const pageSize = 25;

/** Default order: Awaiting clears the oldest held report first, Decided shows the newest. */
export const defaultOrder = (tab: QueueTab): QueueOrder => (tab === "awaiting" ? "asc" : "desc");

/** Validated queue state from the URL; unknown values fall back to the defaults. */
export function queueParams(search: URLSearchParams): QueueParams {
  const tab: QueueTab = search.get("tab") === "decided" ? "decided" : "awaiting",
    game = search.get("game"),
    decision = search.get("decision"),
    order = search.get("order"),
    trip = search.get("trip");
  return {
    tab,
    game: game === "ets2" || game === "ats" ? game : undefined,
    decision:
      tab === "decided" && decisions.includes(decision as QueueDecision)
        ? (decision as QueueDecision)
        : undefined,
    order: order === "asc" || order === "desc" ? order : defaultOrder(tab),
    trip: trip && UUID.test(trip) ? trip : null,
  };
}

/** listTrips parameters for one queue page; the selection never reaches the API. */
export function listQuery(params: QueueParams, cursor: string | null) {
  return {
    scope: "review",
    hold: params.tab === "awaiting" ? "true" : "false",
    game: params.game,
    decision: params.tab === "decided" ? params.decision : undefined,
    order: params.order,
    limit: pageSize,
    cursor: cursor ?? undefined,
  };
}

/** Search string of the validated queue filters (no selection, no cursor) for back links. */
export function queueSearch(search: URLSearchParams): string {
  const params = queueParams(search),
    next = new URLSearchParams();
  if (params.tab === "decided") next.set("tab", "decided");
  if (params.game) next.set("game", params.game);
  if (params.decision) next.set("decision", params.decision);
  if (params.order !== defaultOrder(params.tab)) next.set("order", params.order);
  const value = next.toString();
  return value ? `?${value}` : "";
}

/** Why the trip is in the queue, from the review block of a review-scope summary. */
export function queueType(summary: DTO["TripSummary"]): QueueType {
  const review = summary.review;
  if (!review) return summary.sourceKinds.includes("manual") ? "manual" : "telemetry";
  if (review.reasonCodes.includes(lateTelemetryCode)) return "late_telemetry";
  if (review.manualRevision && review.manualRevision.number > 1) return "resubmission";
  if (review.manualRevision) return "manual";
  return "telemetry";
}

/** The same queue type from the private trip of a review read (no review block there). */
export function reviewType(trip: DTO["TripPrivate"]): QueueType {
  if (trip.reviewReasonCodes.includes(lateTelemetryCode)) return "late_telemetry";
  if (trip.manualRevision) return trip.manualRevision.number > 1 ? "resubmission" : "manual";
  return "telemetry";
}

/** Rule outcomes that record a pass; every other rule code needs an assessment. */
const passCodes = new Set(["rule_passed"]);
// Any rule code that is neither a pass nor an over-limit breach (unknown, invalid or incomplete
// data, unknown rule types) and any unresolved qualification lookup needs an assessment.
const checkCode = (code: string) =>
  (code.startsWith("rule_") && !passCodes.has(code) && !overLimitCodes.has(code)) ||
  code === "unknown_rule_type" ||
  code.startsWith("qualification_");

/** Compact rules flag of a queue row from its stored review reasons. */
export function ruleFlag(reasonCodes: readonly string[]): RuleFlag {
  if (reasonCodes.some((code) => overLimitCodes.has(code))) return "exceeded";
  if (reasonCodes.some(checkCode)) return "check";
  return "none";
}

export const isOwn = (summary: DTO["TripSummary"], memberId: string | undefined) =>
  !!memberId && summary.owner.id === memberId;

/** Queue time: the current manual revision's submission, otherwise the queue entry time. */
export const submittedAt = (summary: DTO["TripSummary"]) =>
  summary.review?.manualRevision?.submittedAt ?? summary.review?.createdAt ?? null;

type Fields = DTO["ManualSubmissionFields"];
export type DiffField = keyof Fields;
export const diffFields: readonly DiffField[] = [
  "game",
  "origin",
  "destination",
  "cargo",
  "cargoMassKg",
  "trailerType",
  "actualDistanceM",
  "eventId",
  "comment",
  "evidenceIds",
];
export type DiffRow = {
  field: DiffField;
  current: Fields[DiffField] | null;
  changed: boolean;
  /** Present only when a previous revision of the same report is compared. */
  previous?: Fields[DiffField] | null;
};

/** The preceding revision of the same report, or null when lineage cannot be proven. */
export function previousRevision(
  current: DTO["ManualRevisionRead"],
  items: readonly DTO["ManualRevisionRead"][],
): DTO["ManualRevisionRead"] | null {
  if (!("reportId" in current)) return null;
  return (
    items.find(
      (item) =>
        "reportId" in item &&
        item.reportId === current.reportId &&
        item.number === current.number - 1,
    ) ?? null
  );
}

/** Field rows of the reviewed revision; with a predecessor every row also carries its value. */
export function diffRows(
  current: DTO["ManualRevisionRead"],
  previous: DTO["ManualRevisionRead"] | null,
): DiffRow[] {
  const now = revisionFields(current),
    before = previous ? revisionFields(previous) : null;
  return diffFields.map((field) => {
    const value = now[field] ?? null;
    if (!before) return { field, current: value, changed: false };
    const old = before[field] ?? null;
    return {
      field,
      current: value,
      previous: old,
      changed: JSON.stringify(value) !== JSON.stringify(old),
    };
  });
}

export type CheckState = "pass" | "fail" | "unknown" | "bypassed" | "unavailable";
export const checkSymbol: Record<CheckState, string> = {
  pass: "✓",
  fail: "✕",
  unknown: "?",
  bypassed: "◇",
  unavailable: "?",
};
export type CheckRow = {
  key: string;
  state: CheckState;
  symbol: string;
  ruleType: string | null;
  reasonCode: string | null;
  observedMassKg: string | null;
  limitMassKg: string | null;
  entityIds: string[];
};

/** Rows of the historical qualification check; unresolved history is one unavailable row. */
export function checkRows(check: DTO["QualificationCheck"]): CheckRow[] {
  if (check.status === "unresolved")
    return [
      {
        key: "unavailable",
        state: "unavailable",
        symbol: checkSymbol.unavailable,
        ruleType: null,
        reasonCode: check.reasonCode,
        observedMassKg: null,
        limitMassKg: null,
        entityIds: [],
      },
    ];
  return check.rules.map((rule, index) => {
    const state: CheckState = rule.bypassedByEvent ? "bypassed" : rule.outcome;
    return {
      key: `${index}-${rule.ruleType}`,
      state,
      symbol: checkSymbol[state],
      ruleType: rule.ruleType,
      reasonCode: rule.reasonCode,
      observedMassKg: rule.observedMassKg,
      limitMassKg: rule.limitMassKg,
      entityIds: rule.entityIds,
    };
  });
}

export type Blocker =
  | "self"
  | "blocked"
  | "choice"
  | "unavailable"
  | "reason"
  | "length"
  | "confirm"
  | "wait"
  | null;
export type DecisionState = {
  canSubmit: boolean;
  needsConfirmation: boolean;
  exceeded: DTO["QualificationRuleCheck"][];
  blockedCodes: string[];
  reasonLabel: "rejection" | "note";
  submitLabel: "reject" | "accept" | "record";
  blocker: Blocker;
};

/** What the decision form allows right now. The server still enforces every rule. */
export function decisionState({
  review,
  choice,
  reason,
  confirmed,
  seconds,
}: {
  review: DTO["Review"];
  choice: Choice | null;
  reason: string;
  confirmed: boolean;
  seconds: number;
}): DecisionState {
  const mode = review.acceptance.mode,
    trimmed = reason.trim(),
    self = review.blockedReasonCodes.includes(selfReviewCode),
    exceeded =
      mode === "over_limits"
        ? review.qualificationCheck.rules.filter((rule) => rule.outcome === "fail")
        : [],
    needsConfirmation = choice === "accept" && mode === "over_limits";
  const blocker: Blocker = self
    ? "self"
    : !review.canDecide
      ? "blocked"
      : !choice
        ? "choice"
        : choice === "accept" && mode === "unavailable"
          ? "unavailable"
          : !trimmed
            ? "reason"
            : trimmed.length > reasonLimit
              ? "length"
              : needsConfirmation && !confirmed
                ? "confirm"
                : seconds > 0
                  ? "wait"
                  : null;
  return {
    canSubmit: blocker === null,
    needsConfirmation,
    exceeded,
    blockedCodes: mode === "unavailable" ? review.acceptance.blockedReasonCodes : [],
    reasonLabel: choice === "reject" ? "rejection" : "note",
    submitLabel: choice ?? "record",
    blocker,
  };
}

/** Exact DecisionInput; the over-limit flag is added only to a confirmed over-limit accept. */
export function decisionBody({
  review,
  choice,
  reason,
  confirmed,
}: {
  review: DTO["Review"];
  choice: Choice;
  reason: string;
  confirmed: boolean;
}): DTO["DecisionInput"] {
  return {
    decision: choice,
    reviewedRevisionId: review.trip.manualRevision?.id ?? review.factRevisionId,
    factRevisionId: review.factRevisionId,
    proposalId: null,
    reason: reason.trim(),
    ...(choice === "accept" && review.acceptance.mode === "over_limits" && confirmed
      ? { confirmOverLimits: true }
      : {}),
  };
}

export type HistoryItem =
  | { kind: "revision"; id: string; number: number; at: string }
  | {
      kind: "decision";
      id: string;
      outcome: DTO["Decision"]["outcome"];
      reviewer: string | null;
      reason: string | null;
      overLimits: boolean;
      at: string;
    };

/** Submitted revisions and decisions, newest first; a decision precedes a same-time submission. */
export function historyItems(
  revisions: readonly DTO["ManualRevisionRead"][],
  decided: readonly DTO["Decision"][],
): HistoryItem[] {
  const items: HistoryItem[] = [
    ...revisions.map((revision) => ({
      kind: "revision" as const,
      id: revision.id,
      number: revision.number,
      at: revision.submittedAt,
    })),
    ...decided.map((decision) => ({
      kind: "decision" as const,
      id: decision.id,
      outcome: decision.outcome,
      reviewer: decision.reviewer?.nickname ?? null,
      reason: decision.reason,
      overLimits: decision.acceptedOverLimits,
      at: decision.decidedAt,
    })),
  ];
  return items.sort((a, b) =>
    a.at === b.at ? (a.kind === b.kind ? 0 : a.kind === "decision" ? -1 : 1) : a.at < b.at ? 1 : -1,
  );
}

/** Day, month and time for a constrained cell; the full value stays available as text. */
export function shortDate(value: string | null, locale: "ru" | "en", timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}
