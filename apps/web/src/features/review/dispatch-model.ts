import { type DTO, selectedTrip, tripSources, validId } from "../trips/transport.js";
import {
  type DirectDecisionInput,
  defaultOrder,
  pageSize,
  type QueueOrder,
  type ReviewData,
} from "./review-model.js";

export type DispatchTab = "queue" | "duplicates" | "resolved";

// Waiting reasons are persisted by the server as trimmed, bounded printable ASCII.
export function isReviewReasonCode(value: string | null | undefined): value is string {
  return !!value && value === value.trim() && /^[ -~]{1,128}$/.test(value);
}

export const reviewReasons = [
  "manual_review_required",
  "missing_actual_start",
  "manual_times_unknown",
  "recording_not_supported",
  "actual_start_unknown",
  "actual_completion_unknown",
  "actual_end_unknown",
  "whole_trip_distance_unknown",
  "actual_distance_unknown",
  "actual_distance_not_positive",
  "actual_time_order_invalid",
  "terminal_outcome_unknown",
  "terminal_outcome_not_delivered",
  "terminal_outcome_conflict",
  "attempted_reopen",
  "origin_unknown",
  "destination_unknown",
  "cargo_unknown",
  "cargoMassKg_unknown",
  "trailer_context_unknown",
  "adr_unknown",
  "rule_context_incomplete",
  "unknown_rule_type",
  "quality_supported_conflict",
  "quality_incomparable_snapshots",
  "quality_cannot_replace_supported_snapshot",
  "reversed_group_new_evidence",
  "start_time_became_unverified",
  "start_time_conflict",
  "end_time_became_unverified",
  "end_time_conflict",
  "origin_became_unknown",
  "origin_conflict",
  "destination_became_unknown",
  "destination_conflict",
  "cargo_became_unknown",
  "cargo_conflict",
  "cargoMassKg_became_unknown",
  "cargoMassKg_conflict",
  "plannedDistanceM_became_unknown",
  "plannedDistanceM_conflict",
  "adrCategory_became_unknown",
  "adrCategory_conflict",
  "actualDistanceM_became_unknown",
  "actualDistanceM_conflict",
  "deliveredDistanceM_became_unknown",
  "deliveredDistanceM_conflict",
  "confirmed_facts_require_review",
  "source_evidence_requires_review",
  "candidate_search_overflow",
  "proposal_pending",
  "author_correction_requested",
  "manual_requires_other_reviewer",
  "event_requires_review",
  "event_prescribed_load_mismatch",
  "manual_evidence_missing",
  "qualification_history_unknown",
  "qualification_rules_unconfigured",
  "qualification_attribution_time_unknown",
  "rule_mass_exceeded",
  "rule_mass_unknown",
  "rule_mass_invalid",
  "rule_trailer_type_disallowed",
  "rule_trailer_type_unknown",
  "rule_trailers_incomplete",
  "rule_adr_category_disallowed",
  "rule_adr_category_unknown",
  "clock_anomaly",
  "damage_out_of_range",
  "quantity_out_of_range",
  "time_order_conflict",
  "distance_conflict",
  "trailer_context_conflict",
  "trip_open",
] as const;

export function dispatchParams(search: URLSearchParams) {
  const tab = search.get("tab");
  const game = search.get("game");
  const reason = search.get("reasonCode");
  const ownerId = search.get("ownerId") ?? undefined;
  const source = search.get("source");
  const order = search.get("order");
  const view: DispatchTab =
    tab === "decided" || tab === "resolved" ? "resolved" : tab === "duplicates" ? tab : "queue";
  const waitingOrder: QueueOrder = order === "desc" ? order : defaultOrder("awaiting");
  return {
    tab: view,
    game: game === "ets2" || game === "ats" ? game : undefined,
    reasonCode: isReviewReasonCode(reason) ? reason : undefined,
    ownerId: validId(ownerId) ? ownerId : undefined,
    source: tripSources.find((value) => value === source),
    order: waitingOrder,
    trip: selectedTrip(search),
    duplicateStatus: search.get("duplicates") === "dismissed" ? "dismissed" : "waiting",
  } as const;
}

export function dispatchSearch(search: URLSearchParams) {
  const { tab, game, reasonCode, ownerId, source, order, duplicateStatus } = dispatchParams(search);
  const next = new URLSearchParams();
  if (tab !== "queue") next.set("tab", tab);
  if (game) next.set("game", game);
  if (reasonCode) next.set("reasonCode", reasonCode);
  if (ownerId) next.set("ownerId", ownerId);
  if (source) next.set("source", source);
  if (order === "desc") next.set("order", order);
  if (duplicateStatus === "dismissed") next.set("duplicates", duplicateStatus);
  const value = next.toString();
  return value ? `?${value}` : "";
}

export function dispatchListQuery(
  params: ReturnType<typeof dispatchParams>,
  cursor: string | null,
  locale: "ru" | "en",
) {
  const { tab, game, reasonCode, ownerId, source, order } = params;
  return {
    scope: "review",
    view: "stage3",
    status: tab === "resolved" ? "resolved" : "waiting",
    game,
    reasonCode,
    ownerId,
    source,
    order: tab === "resolved" ? "desc" : order,
    locale,
    limit: pageSize,
    cursor,
  };
}

export function queueAge(seconds: number, locale: string) {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (seconds >= 86400) return formatter.format(-Math.floor(seconds / 86400), "day");
  if (seconds >= 3600) return formatter.format(-Math.floor(seconds / 3600), "hour");
  if (seconds >= 60) return formatter.format(-Math.floor(seconds / 60), "minute");
  return formatter.format(-seconds, "second");
}

/** Adapt the authorized Stage 3 projection to the existing review form and history. */
export function stagedReview(value: DTO["TripStage3Review"]): ReviewData {
  return {
    acceptance: value.acceptance,
    blockedReasonCodes: value.blockedReasonCodes,
    canDecide: value.canDecide,
    factRevisionId: value.factRevisionId,
    qualificationCheck: value.qualificationCheck,
    trip: {
      summary: value.summary,
      decisions: value.decisions,
      effectiveFacts: value.effectiveFacts,
      evidence: value.sources.manual?.evidence ?? [],
      manualRevision: value.sources.manual?.manualRevision ?? null,
      pendingProposalId: value.pendingProposalId,
      reviewReasonCodes: value.reviewReasonCodes,
    },
  };
}

export function stagedDecisionInput(
  body: DirectDecisionInput,
): DTO["TripStage3AcceptInput"] | DTO["TripStage3ReturnInput"] {
  const { decision, factRevisionId, reviewedRevisionId, reason, confirmOverLimits } = body;
  const snapshot = { factRevisionId, reviewedRevisionId, proposalId: null };
  return decision === "accept"
    ? {
        ...snapshot,
        decision,
        ...(reason ? { reason } : {}),
        ...(confirmOverLimits ? { confirmOverLimits } : {}),
      }
    : { ...snapshot, decision, reason };
}
