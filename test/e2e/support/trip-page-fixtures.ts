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
function rules(view: TripPrivate) {
  const check = view.qualificationCheck;
  if (!check) throw new Error("MISSING_CHECK");
  return check.rules;
}
function trailerRule(view: TripPrivate) {
  const rule = rules(view).find((r) => r.ruleType === "allowed_trailer_types");
  if (rule?.ruleType !== "allowed_trailer_types") throw new Error("MISSING_TRAILER_RULE");
  return rule;
}

/** F1: an accepted telemetry trip linked to an event, with one source and three rules. */
export function telemetryWithEvent() {
  const { envelope, view } = stage4("telemetry");
  view.summary.sourceKinds = ["ets2telemetry"];
  view.summary.event = { id: tripEventId, title: "Fictional Winter Convoy" };
  view.sources = (view.sources ?? []).filter((source) => source.kind === "ets2telemetry");
  trailerRule(view).allowedTrailerTypeCount = 3;
  return envelope;
}

/** F2: a manual trip without an event; unknown companies, distance and damage, unresolved check. */
export function manualUnknown(
  variant: "unresolved" | "no-check" | "no-rules" | "zero-damage" = "unresolved",
) {
  const { envelope, view, facts } = stage4("manual-unresolved");
  view.summary.event = null;
  if (variant === "no-check") view.qualificationCheck = null;
  if (variant === "no-rules")
    view.qualificationCheck = { status: "resolved", reasonCode: null, rules: [] };
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
  // Empty configured allowlists: no trailer type and no ADR class is allowed.
  const trailer = trailerRule(view);
  trailer.allowedTrailerTypes = [];
  trailer.allowedTrailerTypeCount = 0;
  const adr = rules(view).find((r) => r.ruleType === "allowed_adr_categories");
  if (adr?.ruleType !== "allowed_adr_categories") throw new Error("MISSING_ADR_RULE");
  adr.allowedAdrClasses = [];
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
        ruleVersionId: null,
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

/** L1: the reconciled trip with long names, a long event title and a truncated trailer list. */
export function longValues() {
  const { envelope, view, facts } = stage4("telemetry");
  view.summary.event = { id: tripEventId, title: longEventTitle };
  if (facts.originCompany?.state === "resolved") facts.originCompany.name = longCompanyName;
  if (facts.destinationCompany?.state === "resolved")
    facts.destinationCompany.name = `${longCompanyName} Port`;
  const rule = trailerRule(view);
  const [allowed] = rule.allowedTrailerTypes;
  if (allowed) allowed.label = longTrailerLabel;
  const [offending] = rule.offendingTrailerTypes;
  if (offending) offending.label = `${longTrailerLabel} Tanker`;
  rule.allowedTrailerTypeCount = 12;
  return envelope;
}

/** Every stub the browser cases serve, for the unit schema check. */
export function tripPageStubs(): Record<string, TripEnvelope> {
  return {
    telemetryWithEvent: telemetryWithEvent(),
    manualUnknown: manualUnknown(),
    manualNoCheck: manualUnknown("no-check"),
    manualNoRules: manualUnknown("no-rules"),
    manualZeroDamage: manualUnknown("zero-damage"),
    reconciledAccepted: reconciledAccepted(),
    returnedTrip: returnedTrip(),
    olderTelemetry: olderPrivate("private-recorded-telemetry"),
    olderManual: olderPrivate("extended-manual-revision"),
    otherSummary: otherSummary(),
    withoutSources: withoutSources(),
    longValues: longValues(),
  };
}
