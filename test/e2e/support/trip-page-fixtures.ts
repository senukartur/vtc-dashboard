// Synthetic Stage 4 trip page fixtures (VTC-146), built from the reviewed getTrip examples.
// Pure data without Playwright imports, so unit tests parse every fixture with the runtime schemas.
import { readFileSync } from "node:fs";
import type { components } from "@vtc/contracts";
import { fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";

type S = components["schemas"];
type TripPrivate = S["TripPrivate"];
export type TripEnvelope = S["EnvelopeTripView"];

/** The trip the shared trip mock serves; equal to `id` in trip-ui.ts. */
export const tripPageId = "41000000-0000-4000-8000-000000000001";
export const tripEventId = "71000000-0000-4000-8000-000000000146";
export const otherOwnerId = "41000000-0000-4000-8000-000000000099";
export const senderCompanyId = "41500000-0000-4000-8000-000000000320";
export const receiverCompanyId = "41500000-0000-4000-8000-000000000322";

const cases: { id: string; response: unknown }[] = JSON.parse(
  readFileSync(new URL("../../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
).cases;
function example(name: string): TripEnvelope {
  const found = cases.find((c) => c.id === name);
  if (!found) throw new Error(`MISSING_EXAMPLE ${name}`);
  return structuredClone(found.response) as TripEnvelope;
}
/** A Stage 4 private example owned by the signed-in fixture member at the mocked trip id. */
function stage4(name: "telemetry" | "manual-unresolved") {
  const envelope = example(`getTrip:stage-4-private-${name}`);
  const view = envelope.data as TripPrivate;
  view.summary.id = tripPageId;
  view.summary.owner.id = fixtureId;
  return { envelope, view, facts: view.effectiveFacts as S["EffectiveTripFacts"] };
}
function check(view: TripPrivate) {
  if (!view.qualificationCheck) throw new Error("MISSING_CHECK");
  return view.qualificationCheck;
}
function trailerRule(view: TripPrivate) {
  const rule = check(view).rules.find((r) => r.rule === "trailer_types");
  if (rule?.rule !== "trailer_types") throw new Error("MISSING_TRAILER_RULE");
  return rule;
}
function adrRule(view: TripPrivate) {
  const rule = check(view).rules.find((r) => r.rule === "adr");
  if (rule?.rule !== "adr") throw new Error("MISSING_ADR_RULE");
  return rule;
}

/** F1: a telemetry trip linked to an event, with one source and the five checked limits. */
export function telemetryWithEvent() {
  const { envelope, view } = stage4("telemetry");
  view.summary.sourceKinds = ["ets2telemetry"];
  view.summary.event = { id: tripEventId, title: "Fictional Winter Convoy" };
  view.sources = (view.sources ?? []).filter((source) => source.kind === "ets2telemetry");
  return envelope;
}

/** F2: a manual trip without an event; unknown companies, distance, damage and level. */
export function manualUnknown(
  variant: "no-level" | "no-check" | "event-exempt" | "zero-damage" = "no-level",
) {
  const { envelope, view, facts } = stage4("manual-unresolved");
  view.summary.event = null;
  if (variant === "no-check") view.qualificationCheck = null;
  if (variant === "event-exempt")
    view.qualificationCheck = {
      status: "event_exempt",
      basis: "current",
      level: { id: "41570000-0000-4000-8000-000000000001", name: "Fictional Trainee" },
      outcome: null,
      reasonCode: null,
      rules: [],
    };
  if (variant === "zero-damage") facts.cargoDamagePercent = 0;
  return envelope;
}

/** F3: an accepted trip reconciled from telemetry and a manual report. */
export function reconciledAccepted() {
  const { envelope, view } = stage4("telemetry");
  view.summary.event = null;
  return envelope;
}

export const returnedReason = "Fictional screenshot does not show the delivered cargo";

/** F4: the same trip returned to the driver with one rejected decision. */
export function returnedTrip() {
  const { envelope, view } = stage4("telemetry");
  view.summary.decision = "rejected";
  view.summary.event = null;
  // Selected limits without entries: no trailer type and no ADR class is allowed.
  trailerRule(view).allowed = [];
  const adr = adrRule(view);
  adr.mode = "selected";
  adr.allowedClasses = [];
  adr.observed = "3";
  adr.result = "fail";
  view.decisions = [
    {
      id: "41500000-0000-4000-8000-000000000340",
      outcome: "rejected",
      reasonCodes: [],
      reason: returnedReason,
      decidedAt: "2026-11-11T10:00:00.000Z",
      reviewerId: "41500000-0000-4000-8000-000000000003",
      reviewer: {
        id: "41500000-0000-4000-8000-000000000003",
        nickname: "Fictional Stage Four Dispatcher",
        formerMember: false,
        roles: ["dispatcher"],
      },
      acceptedOverLimits: false,
      reviewedRevisionId: null,
      basis: {
        factRevisionId: "41500000-0000-4000-8000-000000000310",
        qualificationAssignmentId: null,
        levelId: null,
        eventId: null,
        attendanceRevisionId: null,
        attributionAt: null,
        attributionBasis: "actual_start",
        reportingAt: null,
      },
    },
  ];
  return envelope;
}

/** F5: views without Stage 4 data, another member's summary, and a trip without sources. */
export function olderPrivate(name: "private-recorded-telemetry" | "extended-manual-revision") {
  const envelope = example(`getTrip:${name}`);
  const view = envelope.data as TripPrivate;
  view.summary.id = tripPageId;
  view.summary.owner.id = fixtureId;
  return envelope;
}
export function otherSummary(): TripEnvelope {
  const { envelope, view } = stage4("telemetry");
  const summary: S["TripSummary"] = { ...view.summary, owner: { ...view.summary.owner } };
  summary.owner.id = otherOwnerId;
  summary.owner.nickname = "Fictional Other Driver";
  // Company scope omits the author-only fields entirely.
  delete summary.event;
  delete summary.gameMode;
  return { ...envelope, data: summary };
}
export function withoutSources() {
  const { envelope, view } = stage4("telemetry");
  view.summary.event = null;
  view.sources = [];
  return envelope;
}

export const longCompanyName = "Fictional Transcontinental Refrigerated Logistics Cooperative";
export const longEventTitle =
  "Fictional Northern Lights Winter Convoy across the Scandinavian ferries and mountain passes with a very long title";
export const longTrailerLabel = "Fictional Extra Long Refrigerated Double Deck Curtainsider";

/** L1: the reconciled trip with long names, a long event title and long trailer labels. */
export function longValues() {
  const { envelope, view, facts } = stage4("telemetry");
  view.summary.event = { id: tripEventId, title: longEventTitle };
  if (facts.originCompany?.state === "resolved") facts.originCompany.name = longCompanyName;
  if (facts.destinationCompany?.state === "resolved")
    facts.destinationCompany.name = `${longCompanyName} Port`;
  const rule = trailerRule(view);
  const [allowed] = rule.allowed;
  if (allowed) {
    allowed.label = longTrailerLabel;
    rule.allowed.push({ ...allowed, entityId: "41500000-0000-4000-8000-000000000332" });
  }
  const [observed] = rule.observed;
  if (observed) observed.label = `${longTrailerLabel} Tanker`;
  return envelope;
}

// VTC-158 trip page states. Every value is fictional.
/** The trailer the shared trip mock answers for; equal to `trailerId` in trip-ui.ts. */
export const fixtureTrailerId = "63000000-0000-4000-8000-000000000022";
export const needsFixReportId = "41500000-0000-4000-8000-000000000360";
export const needsFixReason = "Fictional screenshot hides the driven distance";
export const needsFixEvidence: S["Evidence"] = {
  id: "41500000-0000-4000-8000-000000000350",
  state: "ready",
  contentType: "image/png",
  byteLength: 48213,
  originalName: "fictional-delivery-screen.png",
};
export const fixtureReviewer: S["MemberSummary"] = {
  id: "41500000-0000-4000-8000-000000000003",
  nickname: "Fictional Stage Four Dispatcher",
  formerMember: false,
  roles: ["dispatcher"],
};
const city = (entityId: string, label: string): S["CatalogLabel"] => ({
  entityId,
  label,
  requestedLocale: "en",
  renderedLocale: "en",
  englishFallback: false,
  hidden: false,
});
const decisionBasis = (factRevisionId: string): S["Decision"]["basis"] => ({
  factRevisionId,
  qualificationAssignmentId: null,
  levelId: null,
  eventId: null,
  attendanceRevisionId: null,
  attributionAt: null,
  attributionBasis: "actual_start",
  reportingAt: null,
});

/**
 * R1: the author's manual report returned for fixes: an extended revision with its report, one
 * ready screenshot, an unknown review code, and two decisions listed newest-last out of order.
 */
export function needsFixManual() {
  const { envelope, view, facts } = stage4("manual-unresolved");
  view.summary.number = 1044;
  view.summary.decision = "rejected";
  view.summary.event = null;
  view.summary.origin = city("41500000-0000-4000-8000-000000000361", "Fictional Westport");
  view.summary.destination = city("41500000-0000-4000-8000-000000000362", "Fictional Eastbrook");
  const dated = example("getTrip:dated-private-revision").data as TripPrivate;
  const revision = dated.manualRevision;
  if (!revision || !("reportId" in revision)) throw new Error("MISSING_EXTENDED_REVISION");
  revision.reportId = needsFixReportId;
  revision.submittedAt = "2026-11-11T09:00:00.000Z";
  revision.fields.trailerType = { status: "resolved", entityId: fixtureTrailerId };
  revision.fields.evidenceIds = [needsFixEvidence.id];
  view.manualRevision = revision;
  view.evidence = [{ ...needsFixEvidence }];
  view.reviewReasonCodes = ["manual_report", "SYNTHETIC_STAFF_REVIEW"];
  view.decisions = [
    {
      id: "41500000-0000-4000-8000-000000000371",
      outcome: "rejected",
      reasonCodes: ["SYNTHETIC_REJECTED", "manual_evidence_missing"],
      reason: needsFixReason,
      decidedAt: "2026-11-12T10:31:00.000Z",
      reviewerId: fixtureReviewer.id,
      reviewer: { ...fixtureReviewer },
      acceptedOverLimits: false,
      reviewedRevisionId: revision.id,
      basis: decisionBasis(facts.factRevisionId),
    },
    {
      id: "41500000-0000-4000-8000-000000000370",
      outcome: "rejected",
      reasonCodes: ["manual_evidence_missing"],
      reason: null,
      decidedAt: "2026-11-11T09:05:00.000Z",
      reviewerId: null,
      reviewer: null,
      acceptedOverLimits: false,
      reviewedRevisionId: revision.id,
      basis: decisionBasis(facts.factRevisionId),
    },
  ];
  return envelope;
}

/** The same report waiting for review without decisions; it can still be revised. */
export function pendingManual() {
  const envelope = needsFixManual();
  const view = envelope.data as TripPrivate;
  view.summary.decision = "pending_review";
  view.decisions = [];
  view.reviewReasonCodes = ["manual_review_required", "SYNTHETIC_STAFF_REVIEW"];
  return envelope;
}

/** A telemetry trip still on the road: unassessed, open, without completion. */
export function openTelemetry() {
  const { envelope, view, facts } = stage4("telemetry");
  view.summary.decision = "unassessed";
  view.summary.outcome = "open";
  view.summary.reportingAt = null;
  view.summary.sourceKinds = ["ets2telemetry"];
  view.summary.event = null;
  facts.actualCompletedAt = null;
  view.sources = (view.sources ?? [])
    .filter((source) => source.kind === "ets2telemetry")
    .map((source) => ({ ...source, state: "open" as const }));
  return envelope;
}

/** F1 with one trailer pinned in the effective fact. */
export function withTrailer() {
  const envelope = telemetryWithEvent();
  const facts = (envelope.data as TripPrivate).effectiveFacts as S["EffectiveTripFacts"];
  facts.trailers = [{ entityId: fixtureTrailerId }];
  return envelope;
}

/** The private view inside a stub envelope. */
export const tripPrivate = (envelope: TripEnvelope) => envelope.data as TripPrivate;

/** The same private view owned by another member, as staff read it. */
export function asOtherMember(envelope: TripEnvelope) {
  const view = envelope.data as TripPrivate;
  view.summary.owner = {
    ...view.summary.owner,
    id: otherOwnerId,
    nickname: "Fictional Other Driver",
  };
  return envelope;
}

/** Every stub the browser cases serve, for the unit schema check. */
export function tripPageStubs(): Record<string, TripEnvelope> {
  return {
    telemetryWithEvent: telemetryWithEvent(),
    manualUnknown: manualUnknown(),
    manualNoCheck: manualUnknown("no-check"),
    manualEventExempt: manualUnknown("event-exempt"),
    manualZeroDamage: manualUnknown("zero-damage"),
    reconciledAccepted: reconciledAccepted(),
    returnedTrip: returnedTrip(),
    olderTelemetry: olderPrivate("private-recorded-telemetry"),
    olderManual: olderPrivate("extended-manual-revision"),
    otherSummary: otherSummary(),
    withoutSources: withoutSources(),
    longValues: longValues(),
    needsFixManual: needsFixManual(),
    pendingManual: pendingManual(),
    openTelemetry: openTelemetry(),
    withTrailer: withTrailer(),
    staffNeedsFix: asOtherMember(needsFixManual()),
  };
}
