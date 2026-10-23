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
