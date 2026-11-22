import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { stagedDecisionInput } from "../../apps/web/src/features/review/dispatch-model.ts";
import {
  decisionBody,
  decisionChoices,
  decisionState,
  type ProposalMode,
  proposalBody,
} from "../../apps/web/src/features/review/review-model.ts";
import type { DTO } from "../../apps/web/src/features/trips/transport.ts";
import { correctionProposal } from "../e2e/support/trip-page-fixtures.ts";

// VTC-169 reviewer decisions: accept, return for fixes or a final rejection. Fictional data only.
const cases = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
).cases as { id: string; response: { data: unknown } }[];
function review(correctionReview?: DTO["TripCorrectionReview"]): DTO["Review"] {
  const found = cases.find((c) => c.id === "getTripReview:over-limits");
  if (!found) throw new Error("MISSING_EXAMPLE");
  const value = structuredClone(found.response.data) as DTO["Review"];
  value.acceptance = { mode: "ordinary", blockedReasonCodes: [] };
  value.trip.summary.decision = "pending_review";
  if (correctionReview) value.correctionReview = correctionReview;
  else delete value.correctionReview;
  return value;
}
const correctable = (
  extra: Partial<DTO["TripCorrectionReview"]> = {},
): DTO["TripCorrectionReview"] => ({
  blockedOnlyByEditable: false,
  canReturn: true,
  clientReasonCodes: [],
  proposalAcceptance: null,
  ...extra,
});
function mode(data: DTO["Review"], extra: Partial<DTO["TripProposal"]> = {}): ProposalMode {
  const proposal = {
    ...correctionProposal("63000000-0000-4000-8000-000000000021", data.trip.summary.id),
    authorId: data.trip.summary.owner.id,
    ...extra,
  };
  return { proposal, authored: !!proposal.changes, oldFormat: false };
}
const state = (
  data: DTO["Review"],
  choice: "accept" | "return" | "reject",
  proposal: ProposalMode | null = null,
  reason = "Fictional reviewer note",
) => decisionState({ review: data, choice, reason, confirmed: false, seconds: 0, proposal });

test("Return is offered only when the server says something is correctable", () => {
  expect(decisionChoices(review()).choices).toEqual(["accept", "reject"]);
  expect(decisionChoices(review(correctable({ canReturn: false }))).choices).toEqual([
    "accept",
    "reject",
  ]);
  expect(decisionChoices(review(correctable())).choices).toEqual(["accept", "return", "reject"]);
  expect(state(review(correctable({ canReturn: false })), "return").blocker).toBe("return");
  expect(state(review(correctable()), "return", null, "  ").blocker).toBe("reason");
  expect(state(review(correctable()), "return")).toMatchObject({ canSubmit: true });
});

test("a return is a rejection with the return flag in both decision paths", () => {
  const data = review(correctable());
  const returned = decisionBody({
    review: data,
    choice: "return",
    reason: " Fictional return ",
    confirmed: false,
  });
  expect(returned).toMatchObject({ decision: "reject", reason: "Fictional return" });
  expect(returned.returnForFixes).toBe(true);
  expect(
    decisionBody({ review: data, choice: "reject", reason: "Fictional", confirmed: false }),
  ).not.toHaveProperty("returnForFixes");
  expect(stagedDecisionInput(returned)).toMatchObject({ decision: "reject", returnForFixes: true });
});

test("a driver's correction is approved, returned or rejected with the trip decision", () => {
  const data = review(
    correctable({ proposalAcceptance: { mode: "ordinary", blockedReasonCodes: [] } }),
  );
  const proposal = mode(data);
  expect(decisionChoices(data, proposal).choices).toEqual(["accept", "return", "reject"]);
  const body = (choice: "accept" | "return" | "reject") =>
    proposalBody({ review: data, proposal, choice, reason: " Fictional review " });
  const revision = { reviewedRevisionId: proposal.proposal.revisionId, reason: "Fictional review" };
  expect(body("accept")).toEqual({ ...revision, decision: "approve" });
  expect(body("return")).toEqual({
    ...revision,
    decision: "reject",
    tripDecision: "returned_for_fixes",
  });
  expect(body("reject")).toEqual({ ...revision, decision: "reject", tripDecision: "rejected" });
  // Proposal decisions always need a comment, even where a direct acceptance may omit it.
  expect(
    decisionState({
      review: data,
      choice: "accept",
      reason: " ",
      confirmed: false,
      seconds: 0,
      optionalAcceptReason: true,
      proposal,
    }).blocker,
  ).toBe("reason");
});

test("an accepted trip only declines a correction and its acceptance follows the proposal", () => {
  const accepted = review(
    correctable({
      proposalAcceptance: { mode: "unavailable", blockedReasonCodes: ["telemetry_source_present"] },
    }),
  );
  accepted.trip.summary.decision = "accepted";
  const proposal = mode(accepted);
  expect(decisionChoices(accepted, proposal).choices).toEqual(["accept", "reject"]);
  expect(
    proposalBody({ review: accepted, proposal, choice: "reject", reason: "Fictional decline" }),
  ).not.toHaveProperty("tripDecision");
  expect(state(accepted, "accept", proposal)).toMatchObject({
    blocker: "unavailable",
    blockedCodes: ["telemetry_source_present"],
  });
  // A proposal never waives qualification limits.
  const over = review(
    correctable({ proposalAcceptance: { mode: "over_limits", blockedReasonCodes: [] } }),
  );
  expect(state(over, "accept", mode(over))).toMatchObject({
    needsConfirmation: false,
    canSubmit: true,
  });
});

test("an old-format request can only be declined and never decides the trip", () => {
  const data = review(
    correctable({ proposalAcceptance: { mode: "ordinary", blockedReasonCodes: [] } }),
  );
  const old: ProposalMode = {
    ...mode(data, {
      kind: "correction_request",
      changes: null,
      correctionRequestId: "41500000-0000-4000-8000-000000000390",
    }),
    authored: false,
    oldFormat: true,
  };
  expect(decisionChoices(data, old).choices).toEqual(["accept", "reject"]);
  expect(state(data, "accept", old).blocker).toBe("unavailable");
  expect(
    proposalBody({ review: data, proposal: old, choice: "reject", reason: "Fictional decline" }),
  ).toEqual({
    decision: "reject",
    reviewedRevisionId: old.proposal.revisionId,
    reason: "Fictional decline",
  });
});
