import { newId } from "@vtc/db";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
import {
  tripDecisionEvent,
  tripProposalReviewedEvent,
} from "../../apps/api/src/platform/outbox/events.ts";

const validate = createSchemaValidator();
test("decision events contain only registered references and monotonic contribution version", () => {
  const e = {
    eventId: newId(),
    type: "trip.decision_changed",
    schemaVersion: 1,
    aggregate: { kind: "trip", id: newId(), version: 2 },
    occurredAt: "2026-10-22T12:00:00.000Z",
    correlationId: newId(),
    causationId: null,
    data: { decisionId: newId(), contributionVersion: 1 },
  };
  expect(tripDecisionEvent(e)).toEqual(e);
  expect(() => tripDecisionEvent({ ...e, data: { ...e.data, reason: "private" } })).toThrow();
  expect(() => tripDecisionEvent({ ...e, data: { ...e.data, contributionVersion: 0 } })).toThrow();
});
test("existing resolution and proposal contracts reject manual dates and incomplete reviewed revisions", () => {
  const resolution = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/ResolutionInput" }),
    review = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/ProposalDecisionInput" });
  expect(
    resolution({ reason: "Fictional correction", evidenceIds: [], actualDistanceM: "100" }),
  ).toBe(true);
  expect(
    resolution({ reason: "Fictional correction", evidenceIds: [], tripDate: "2026-10-22" }),
  ).toBe(false);
  expect(review({ decision: "approve", reason: "Reviewed" })).toBe(false);
});

test("proposal-decision response preserves terminal fixtures and uses the actual proposal for pre-first-decision rejection", async () => {
  const { readFileSync } = await import("node:fs"),
    examples = JSON.parse(
      readFileSync(
        new URL("../../docs/contracts/dashboard/examples.json", import.meta.url),
        "utf8",
      ),
    ),
    check = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/EnvelopeTripProposalDecision" });
  for (const id of [
    "decideTripProposal:success",
    "decideTripProposal:reject-before-first-decision",
  ])
    expect(check(examples.cases.find((c: { id: string }) => c.id === id).response)).toBe(true);
  const e = {
    eventId: newId(),
    type: "trip.proposal_reviewed",
    schemaVersion: 1,
    aggregate: { kind: "trip", id: newId(), version: 2 },
    occurredAt: "2026-10-22T12:00:00.000Z",
    correlationId: newId(),
    causationId: null,
    data: { proposalId: newId(), reviewedRevisionId: newId() },
  };
  expect(tripProposalReviewedEvent(e)).toEqual(e);
  expect(() =>
    tripProposalReviewedEvent({ ...e, data: { ...e.data, reason: "private" } }),
  ).toThrow();
});

test("optional immutable event-association proposal refs retain old valid fixtures and reject private fields", async () => {
  const { readFileSync } = await import("node:fs"),
    examples = JSON.parse(
      readFileSync(
        new URL("../../docs/contracts/dashboard/examples.json", import.meta.url),
        "utf8",
      ),
    );
  const check = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/EnvelopeTripProposal" });
  const current = examples.cases.find(
    (c: { id: string }) => c.id === "getTripProposal:event-association",
  ).response;
  expect(check(current)).toBe(true);
  expect(
    check(examples.cases.find((c: { id: string }) => c.id === "getTripProposal:success").response),
  ).toBe(true);
  expect(
    check({
      ...current,
      data: {
        ...current.data,
        eventAssociation: { ...current.data.eventAssociation, note: "private" },
      },
    }),
  ).toBe(false);
});

test("optional correction request association requires actual changes and preserves omitted and null inputs", () => {
  const resolution = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/ResolutionInput" });
  const basic = { reason: "Fictional linked correction", evidenceIds: [] };
  for (const correctionRequestId of [undefined, null, newId()]) {
    const association = correctionRequestId === undefined ? {} : { correctionRequestId };
    expect(resolution({ ...basic, ...association })).toBe(false);
    expect(resolution({ ...basic, ...association, actualDistanceM: "100" })).toBe(true);
  }
  expect(resolution({ ...basic, correctionRequestId: "not-an-id", actualDistanceM: "100" })).toBe(
    false,
  );
});

test("over-limit acceptance input, decision marker, review details and queue filters are strict", async () => {
  const { readFileSync } = await import("node:fs"),
    read = (name: string) =>
      JSON.parse(
        readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
      ),
    examples = read("examples.json"),
    spec = read("openapi.json"),
    example = (id: string) => examples.cases.find((c: { id: string }) => c.id === id),
    compile = (name: string) => validate.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
  const input = compile("DecisionInput"),
    body = {
      decision: "accept",
      reviewedRevisionId: newId(),
      factRevisionId: newId(),
      proposalId: null,
      reason: "Fictional over-limit review",
    };
  expect(input(body)).toBe(true);
  for (const confirmOverLimits of [true, false])
    expect(input({ ...body, confirmOverLimits })).toBe(true);
  for (const confirmOverLimits of ["true", 1, null])
    expect(input({ ...body, confirmOverLimits })).toBe(false);
  expect(input({ ...body, overrideLimits: true })).toBe(false);
  expect(example("decideTrip:accepted-over-limits").request.confirmOverLimits).toBe(true);

  const decision = compile("EnvelopeDecision");
  for (const id of ["decideTrip:success", "decideTrip:accepted-over-limits"])
    expect(decision(example(id).response), id).toBe(true);
  const marked = example("decideTrip:accepted-over-limits").response;
  expect(marked.data).toMatchObject({
    outcome: "accepted",
    acceptedOverLimits: true,
    reviewer: { id: marked.data.reviewerId, roles: ["dispatcher"] },
    reasonCodes: ["rule_mass_exceeded", "accepted_over_limits"],
  });
  for (const field of ["reviewer", "acceptedOverLimits"]) {
    const { [field]: _omitted, ...rest } = marked.data;
    expect(decision({ ...marked, data: rest }), field).toBe(false);
  }
  expect(decision({ ...marked, data: { ...marked.data, reviewer: { id: newId() } } })).toBe(false);

  const review = compile("EnvelopeReview");
  for (const id of ["getTripReview:success", "getTripReview:over-limits"])
    expect(review(example(id).response), id).toBe(true);
  const detail = example("getTripReview:over-limits").response,
    rule = detail.data.qualificationCheck.rules[0];
  expect(detail.data.acceptance).toEqual({ mode: "over_limits", blockedReasonCodes: [] });
  for (const field of ["qualificationCheck", "acceptance"]) {
    const { [field]: _omitted, ...rest } = detail.data;
    expect(review({ ...detail, data: rest }), field).toBe(false);
  }
  const withRule = (patch: object) => ({
    ...detail,
    data: {
      ...detail.data,
      qualificationCheck: { ...detail.data.qualificationCheck, rules: [{ ...rule, ...patch }] },
    },
  });
  expect(review(withRule({ observedMassKg: null, limitMassKg: null }))).toBe(true);
  expect(review(withRule({ observedMassKg: 21000 }))).toBe(false);
  expect(review(withRule({ observedMassKg: "-1" }))).toBe(false);
  expect(review(withRule({ entityIds: Array.from({ length: 11 }, () => newId()) }))).toBe(false);
  expect(review(withRule({ outcome: "waived" }))).toBe(false);
  expect(
    review({
      ...detail,
      data: { ...detail.data, acceptance: { mode: "forced", blockedReasonCodes: [] } },
    }),
  ).toBe(false);

  const page = compile("EnvelopeListTripSummary"),
    queue = example("listTrips:review-queue").response;
  expect(page(queue)).toBe(true);
  expect(page(example("listTrips:success").response)).toBe(true);
  const item = queue.data.items[0];
  expect(
    page({
      ...queue,
      data: { ...queue.data, items: [{ ...item, review: { ...item.review, hold: "true" } }] },
    }),
  ).toBe(false);
  expect(
    page({
      ...queue,
      data: { ...queue.data, items: [{ ...item, review: { ...item.review, note: "private" } }] },
    }),
  ).toBe(false);
  expect(compile("EnvelopeTripView")(example("getTrip:resubmitted-with-history").response)).toBe(
    true,
  );
  const parameters = Object.fromEntries(
    spec.paths["/api/v1/trips"].get.parameters
      .filter((p: { name?: string }) => p.name)
      .map((p: { name: string; schema: unknown }) => [p.name, p.schema]),
  );
  expect(parameters.hold).toEqual({ type: "boolean" });
  expect(parameters.order).toEqual({
    type: "string",
    enum: ["asc", "desc", "completion_asc", "completion_desc"],
    default: "desc",
  });
});
