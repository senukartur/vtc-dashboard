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

test("Stage 3 direct acceptance may omit its reason, while return and proposal decisions require text", () => {
  const stage = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/TripStage3DecisionInput" });
  const legacy = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/DecisionInput" });
  const accept = {
    decision: "accept",
    reviewedRevisionId: newId(),
    factRevisionId: newId(),
    proposalId: null,
  };
  expect(stage(accept)).toBe(true);
  expect(legacy(accept)).toBe(false);
  for (const reason of ["", " \t\n"]) expect(stage({ ...accept, reason })).toBe(true);
  expect(stage({ ...accept, confirmOverLimits: true })).toBe(true);
  expect(stage({ ...accept, reason: null })).toBe(false);
  expect(stage({ ...accept, privateMetadata: true })).toBe(false);

  const returned = { ...accept, decision: "reject" };
  const proposal = { ...accept, proposalId: newId() };
  for (const input of [returned, proposal, { ...proposal, decision: "reject" }]) {
    expect(stage(input)).toBe(false);
    expect(stage({ ...input, reason: "   " })).toBe(false);
    expect(stage({ ...input, reason: "Fictional review comment" })).toBe(true);
    expect(stage({ ...input, reason: "Fictional review comment", confirmOverLimits: true })).toBe(
      false,
    );
  }
});

test("Stage 3 review compares independently present manual and telemetry sources", async () => {
  const { readFileSync } = await import("node:fs");
  const examples = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
  );
  const review = validate.compile({ $ref: "urn:vtc:browser:v1#/$defs/TripStage3ReviewEnvelope" });
  for (const kind of ["manual", "telemetry", "mixed"]) {
    const response = examples.cases.find(
      (c: { id: string }) => c.id === `getTripReview:stage-3-${kind}`,
    ).response;
    const { sources } = response.data;
    expect(Boolean(sources.manual)).toBe(kind !== "telemetry");
    expect(Boolean(sources.telemetry)).toBe(kind !== "manual");
    expect(review(response)).toBe(true);
    expect(
      review({ ...response, data: { ...response.data, sources: { ...sources, rawPayload: {} } } }),
    ).toBe(false);
    if (sources.telemetry) {
      const { normalizedFacts, facts } = sources.telemetry;
      expect(normalizedFacts.provider).toBe("ets2telemetry");
      expect(normalizedFacts.plannedDistanceM).toBeNull();
      expect(facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "actual_distance",
            evidenceRecordId: normalizedFacts.sourceRecordId,
          }),
        ]),
      );
      const {
        acceptance,
        effectiveFacts,
        evaluation,
        factRevisionId,
        qualificationCheck,
        summary,
      } = response.data;
      expect(evaluation.factRevisionId).toBe(factRevisionId);
      expect(effectiveFacts.factRevisionId).toBe(factRevisionId);
      expect(qualificationCheck.reasonCode).toBe("qualification_history_unknown");
      if (kind === "mixed") {
        expect(effectiveFacts.provider).toBe("manual");
        expect(evaluation.attributionBasis).toBe("manual_confirmation");
        expect(evaluation.reportingAt).toBe(evaluation.attributionAt);
        expect(acceptance).toEqual({
          mode: "unavailable",
          blockedReasonCodes: ["cargo_unknown", "qualification_history_unknown"],
        });
        expect(normalizedFacts.factRevisionId).not.toBe(
          response.data.effectiveFacts.factRevisionId,
        );
        expect(normalizedFacts.actualDistanceM).not.toBe(
          sources.manual.manualRevision.fields.actualDistanceM,
        );
        expect(normalizedFacts.destination.entityId).not.toBe(
          sources.manual.manualRevision.fields.destination.entityId,
        );
        expect(normalizedFacts.cargoDamagePercent).toBe(0);
      } else {
        expect(normalizedFacts.cargoDamagePercent).toBeNull();
        expect(evaluation.factRevisionId).toBe(normalizedFacts.factRevisionId);
        expect(evaluation.attributionAt).toBe(normalizedFacts.actualStartAt);
        expect(evaluation.reportingAt).toBe(normalizedFacts.actualCompletedAt);
        expect(evaluation.reportingAt).toBe(summary.reportingAt);
        expect(acceptance).toEqual({
          mode: "unavailable",
          blockedReasonCodes: ["qualification_history_unknown"],
        });
      }
      const normalized = validate.compile({
        $ref: "urn:vtc:browser:v1#/$defs/TripStage3TelemetryNormalizedFacts",
      });
      for (const patch of [
        { provider: "manual" },
        { sourceRecordId: "raw-provider-id" },
        { origin: { ...normalizedFacts.origin, rawPayload: {} } },
        { cargoDamagePercent: -1 },
        { cargoDamagePercent: 101 },
        { cargoDamagePercent: "10" },
        { originCompanyId: newId() },
        { rawPayload: {} },
      ])
        expect(normalized({ ...normalizedFacts, ...patch })).toBe(false);
      const checkSource = validate.compile({
        $ref: "urn:vtc:browser:v1#/$defs/TripStage3TelemetryReview",
      });
      expect(checkSource({ facts })).toBe(false);
      expect(
        review({
          ...response,
          data: {
            ...response.data,
            sources: { ...sources, telemetry: { ...sources.telemetry, rawPayload: {} } },
          },
        }),
      ).toBe(false);
    }
  }
});
