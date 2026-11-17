import { expect, test } from "vitest";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { type DTO, schema } from "../../apps/web/src/features/trips/transport.ts";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import {
  canRevise,
  creditState,
  damageValue,
  distanceNote,
  latestDecision,
  nextStep,
  reasonLabelKey,
  reasonLabelKeys,
  recordedValueKey,
  reportedDamage,
  revisableReportId,
  sourceOutcomeKey,
  tripHistory,
  tripStatus,
  tripTimes,
  unknownHintKey,
} from "../../apps/web/src/features/trips/trip-page-model.ts";
import {
  asOtherMember,
  fixtureReviewer,
  manualUnknown,
  needsFixManual,
  needsFixReason,
  needsFixReportId,
  olderPrivate,
  openTelemetry,
  otherOwnerId,
  otherSummary,
  pendingManual,
  reconciledAccepted,
  returnedTrip,
  telemetryWithEvent,
  tripPageStubs,
} from "../e2e/support/trip-page-fixtures.ts";

const privateView = (envelope: DTO["EnvelopeTripView"]) => envelope.data as DTO["TripPrivate"];

test("every trip page browser stub keeps the full contract shape", () => {
  for (const [name, stub] of Object.entries(tripPageStubs())) {
    const parsed = schema("EnvelopeTripView").safeParse(stub);
    expect(parsed.success, name).toBe(true);
  }
});

test("stub checks cover the checked, event-exempt, unknown-level and missing states", () => {
  const checked = privateView(telemetryWithEvent()).qualificationCheck;
  expect(checked?.status).toBe("checked");
  expect(checked?.basis).toBe("decision");
  expect(checked?.rules.map(({ rule, result }) => `${rule}:${result}`)).toEqual([
    "cargo_mass:pass",
    "distance:pass",
    "trailer_types:fail",
    "adr:pass",
    "hard_mode:pass",
  ]);
  expect(privateView(manualUnknown()).qualificationCheck).toMatchObject({
    status: "no_level",
    level: null,
    rules: [],
  });
  expect(privateView(manualUnknown("event-exempt")).qualificationCheck).toMatchObject({
    status: "event_exempt",
    rules: [],
  });
  expect(privateView(manualUnknown("no-check")).qualificationCheck).toBeNull();
  const returned = privateView(returnedTrip()).qualificationCheck?.rules ?? [];
  expect(returned.flatMap((rule) => (rule.rule === "trailer_types" ? rule.allowed : []))).toEqual(
    [],
  );
});

test("source outcome keys and unknown damage stay distinct from zero", () => {
  expect(sourceOutcomeKey("open")).toBe("outcomeOpen");
  expect(sourceOutcomeKey("delivered")).toBe("delivered");
  expect(sourceOutcomeKey("cancelled")).toBe("cancelled");
  expect(sourceOutcomeKey("none")).toBe("none");
  expect(damageValue(privateView(manualUnknown()).effectiveFacts)).toBeNull();
  expect(damageValue(privateView(manualUnknown("zero-damage")).effectiveFacts)).toBe(0);
  expect(damageValue(privateView(telemetryWithEvent()).effectiveFacts)).toBe(37.5);
  const { cargoDamagePercent: _omitted, ...absent } = privateView(manualUnknown())
    .effectiveFacts as DTO["EffectiveTripFacts"];
  expect(damageValue(absent)).toBeNull();
  expect(damageValue(null)).toBeNull();
});

test("the trip page keys exist in both languages", () => {
  const keys = [
    "sourcesTitle",
    "sourcesEmpty",
    "sourceReceived",
    "sourceEffective",
    "senderCompany",
    "receiverCompany",
    "companyUnknown",
    "outcomeOpen",
  ] as const;
  for (const key of keys) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    expect(tripTranslations.ru[key]).not.toBe(tripTranslations.en[key]);
  }
});

// VTC-158 trip page view model.
const decision = (
  outcome: "accepted" | "rejected",
  decidedAt: string,
  extra: Partial<DTO["Decision"]> = {},
): DTO["Decision"] => ({
  id: `41500000-0000-4000-8000-0000000004${decidedAt.slice(8, 10)}`,
  outcome,
  reasonCodes: [],
  reason: null,
  decidedAt,
  reviewerId: null,
  reviewer: null,
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
  ...extra,
});

test("trip status names every decision and outcome, and a returned report only when revisable", () => {
  expect(tripStatus({ decision: "accepted", outcome: "delivered" }, false)).toBe("accepted");
  expect(tripStatus({ decision: "pending_review", outcome: "delivered" }, true)).toBe(
    "pending_review",
  );
  expect(tripStatus({ decision: "rejected", outcome: "delivered" }, true)).toBe("needs_fix");
  expect(tripStatus({ decision: "rejected", outcome: "delivered" }, false)).toBe("rejected");
  expect(tripStatus({ decision: "unassessed", outcome: "open" }, false)).toBe("in_progress");
  expect(tripStatus({ decision: "unassessed", outcome: "cancelled" }, false)).toBe("cancelled");
  expect(tripStatus({ decision: "unassessed", outcome: "delivered" }, false)).toBe("unassessed");
  expect(tripStatus({ decision: "unassessed", outcome: "none" }, false)).toBe("unassessed");
  for (const status of [
    "accepted",
    "pending_review",
    "needs_fix",
    "rejected",
    "in_progress",
    "unassessed",
    "cancelled",
  ] as const)
    expect(tripTranslations.en[`status_${status}`]).toBeTruthy();
});

test("only the owner may revise a report-backed revision that is not accepted", () => {
  const returned = needsFixManual();
  expect(canRevise(returned.data, fixtureId)).toBe(true);
  expect(revisableReportId(returned.data, fixtureId)).toBe(needsFixReportId);
  expect(canRevise(returned.data, otherOwnerId)).toBe(false);
  expect(canRevise(returned.data, undefined)).toBe(false);
  expect(canRevise(asOtherMember(needsFixManual()).data, fixtureId)).toBe(false);
  const accepted = needsFixManual();
  privateView(accepted).summary.decision = "accepted";
  expect(canRevise(accepted.data, fixtureId)).toBe(false);
  expect(canRevise(olderPrivate("extended-manual-revision").data, fixtureId)).toBe(true);
  // A legacy revision has no report to edit.
  const legacy = needsFixManual();
  privateView(legacy).manualRevision = {
    id: "41500000-0000-4000-8000-000000000380",
    number: 1,
    submittedAt: "2026-11-11T09:00:00.000Z",
    fields: {
      game: "ets2",
      originCityId: "41500000-0000-4000-8000-000000000381",
      destinationCityId: "41500000-0000-4000-8000-000000000382",
      cargoId: "41500000-0000-4000-8000-000000000383",
      trailerTypeId: "41500000-0000-4000-8000-000000000384",
      cargoMassKg: "1000",
      actualDistanceM: "1000",
      evidenceIds: [],
      eventId: null,
      comment: null,
    },
  } as unknown as DTO["ManualRevision"];
  expect(canRevise(legacy.data, fixtureId)).toBe(false);
  expect(canRevise(otherSummary().data, otherOwnerId)).toBe(false);
});

test("the next step serves the author, staff and nobody else, with the latest decision reason", () => {
  const returned = needsFixManual();
  const author = nextStep(returned.data, { owner: true, staff: false, revisable: true });
  expect(author).toMatchObject({
    titleKey: "next_fix",
    attention: true,
    reviewer: "Fictional Stage Four Dispatcher",
    reason: needsFixReason,
    // The unknown code reads as a generic reason; the known one keeps its label.
    reasonKeys: ["reasonOther", "code_manual_evidence_missing"],
  });
  // The newest decision wins whatever the array order.
  privateView(returned).decisions.reverse();
  expect(nextStep(returned.data, { owner: true, staff: false, revisable: true })?.reason).toBe(
    needsFixReason,
  );
  expect(nextStep(returned.data, { owner: false, staff: false, revisable: false })).toBeNull();
  expect(nextStep(otherSummary().data, { owner: false, staff: true, revisable: false })).toBeNull();
  expect(nextStep(undefined, { owner: true, staff: true, revisable: false })).toBeNull();
  const staffRejected = nextStep(asOtherMember(needsFixManual()).data, {
    owner: false,
    staff: true,
    revisable: false,
  });
  expect(staffRejected).toMatchObject({ titleKey: "next_rejected", attention: false, held: false });

  const pending = pendingManual();
  expect(nextStep(pending.data, { owner: true, staff: false, revisable: true })).toMatchObject({
    titleKey: "next_none",
    noteKey: "next_pending_note",
    attention: false,
    held: true,
    reasonKeys: ["code_manual_review_required", "reasonOther"],
  });
  expect(nextStep(pending.data, { owner: false, staff: true, revisable: false })).toMatchObject({
    titleKey: "next_pending_staff",
    attention: false,
  });
  // A staff owner is the author first.
  expect(nextStep(pending.data, { owner: true, staff: true, revisable: true })?.titleKey).toBe(
    "next_none",
  );
  privateView(pending).pendingProposalId = "41500000-0000-4000-8000-000000000390";
  expect(nextStep(pending.data, { owner: true, staff: false, revisable: true })?.titleKey).toBe(
    "next_correction",
  );
  expect(
    nextStep(reconciledAccepted().data, { owner: true, staff: false, revisable: false })?.titleKey,
  ).toBe("next_none");
  expect(
    nextStep(openTelemetry().data, { owner: true, staff: false, revisable: false })?.titleKey,
  ).toBe("next_open");
  const cancelled = openTelemetry();
  privateView(cancelled).summary.outcome = "cancelled";
  expect(nextStep(cancelled.data, { owner: true, staff: false, revisable: false })?.titleKey).toBe(
    "next_cancelled",
  );
  const unassessed = openTelemetry();
  privateView(unassessed).summary.outcome = "delivered";
  expect(nextStep(unassessed.data, { owner: true, staff: false, revisable: false })?.titleKey).toBe(
    "next_unassessed",
  );
  for (const view of [needsFixManual(), pendingManual(), openTelemetry(), reconciledAccepted()])
    for (const flags of [
      { owner: true, staff: false, revisable: canRevise(view.data, fixtureId) },
      { owner: false, staff: true, revisable: false },
    ]) {
      const step = nextStep(view.data, flags);
      expect(step?.attention).toBe(step?.titleKey === "next_fix");
    }
});

test("credit follows acceptance with the reporting basis, never a raw reporting instant", () => {
  const accepted = privateView(reconciledAccepted()).summary;
  expect(creditState(accepted)).toEqual({
    valueKey: "creditedYes",
    noteKey: "creditedOn",
    at: "2026-11-10T18:00:00.000Z",
    basisKey: "creditedBasis_unknown",
  });
  expect(creditState({ ...accepted, reportingBasis: "actual_completion" }).basisKey).toBe(
    "creditedBasis_actual_completion",
  );
  expect(creditState({ ...accepted, reportingBasis: "manual_confirmation" }).basisKey).toBe(
    "creditedBasis_manual_confirmation",
  );
  expect(creditState({ ...accepted, reportingAt: null }).noteKey).toBe("creditedCounted");
  expect(creditState({ ...accepted, decision: "rejected" })).toMatchObject({
    valueKey: "creditedNo",
    basisKey: null,
  });
  // A report returned for fixes can still count once it is accepted.
  expect(creditState({ ...accepted, decision: "rejected" }, true)).toMatchObject({
    valueKey: "creditedNotYet",
    noteKey: "creditedAfterAcceptance",
  });
  expect(
    creditState({ ...accepted, outcome: "cancelled", decision: "rejected" }, true).valueKey,
  ).toBe("creditedNo");
  expect(creditState({ ...accepted, decision: "unassessed", outcome: "cancelled" }).valueKey).toBe(
    "creditedNo",
  );
  expect(creditState({ ...accepted, decision: "pending_review" })).toMatchObject({
    valueKey: "creditedNotYet",
    noteKey: "creditedAfterAcceptance",
    at: null,
  });
});

test("distance names its source, missing telemetry and keeps unknown apart from zero", () => {
  const telemetry = privateView(telemetryWithEvent());
  expect(distanceNote(telemetry.summary, telemetry.effectiveFacts)).toEqual({
    value: "812400.5",
    sourceKey: "distanceByTelemetry",
    noTelemetry: false,
  });
  const manual = privateView(manualUnknown());
  expect(distanceNote(manual.summary, manual.effectiveFacts)).toEqual({
    value: "500000",
    sourceKey: "distanceByReport",
    noTelemetry: true,
  });
  expect(distanceNote({ ...manual.summary, actualDistanceM: null }, manual.effectiveFacts)).toEqual(
    { value: null, sourceKey: null, noTelemetry: true },
  );
  expect(distanceNote({ ...manual.summary, actualDistanceM: "0" }, null)).toEqual({
    value: "0",
    sourceKey: null,
    noTelemetry: true,
  });
});

test("trip times prefer actual facts, then the reference times of the report, else nothing", () => {
  const telemetry = privateView(telemetryWithEvent());
  expect(tripTimes(telemetry.effectiveFacts, null)).toEqual({
    startedAt: "2026-11-10T10:00:00.000Z",
    completedAt: "2026-11-10T18:00:00.000Z",
    reported: false,
  });
  expect(
    tripTimes(null, privateView(olderPrivate("extended-manual-revision")).manualRevision),
  ).toBe(null);
  const reported = privateView(needsFixManual()).manualRevision;
  expect(tripTimes(null, reported)).toEqual({
    startedAt: "2026-10-20T09:00:00.000Z",
    completedAt: "2026-10-20T10:00:00.000Z",
    reported: true,
  });
  expect(tripTimes(privateView(openTelemetry()).effectiveFacts, null)).toEqual({
    startedAt: "2026-11-10T10:00:00.000Z",
    completedAt: null,
    reported: false,
  });
  expect(tripTimes(null, null)).toBeNull();
  // Damage of the effective fact first, then the reported damage; unknown is never zero.
  expect(reportedDamage(privateView(manualUnknown()).effectiveFacts, reported)).toBe(12.5);
  expect(reportedDamage(privateView(manualUnknown("zero-damage")).effectiveFacts, reported)).toBe(
    0,
  );
  expect(reportedDamage(privateView(manualUnknown()).effectiveFacts, null)).toBeNull();
});

test("reason codes read as words, unknown codes as a generic reason, without duplicates", () => {
  expect(reasonLabelKey("manual_review_required")).toBe("code_manual_review_required");
  expect(reasonLabelKey("manual_report")).toBe("reasonOther");
  expect(reasonLabelKey("SYNTHETIC_REJECTED")).toBe("reasonOther");
  expect(reasonLabelKey("SYNTHETIC_STAFF_REVIEW")).toBe("reasonOther");
  expect(
    reasonLabelKeys([
      "SYNTHETIC_REJECTED",
      "manual_report",
      "rule_mass_exceeded",
      "accepted_over_limits",
      "rule_mass_exceeded",
    ]),
  ).toEqual(["reasonOther", "code_rule_mass_exceeded"]);
  expect(reasonLabelKey("accepted_over_limits")).toBe("code_accepted_over_limits");
  expect(latestDecision([])).toBeNull();
  const older = decision("accepted", "2026-11-01T10:00:00.000Z");
  const newer = decision("rejected", "2026-11-02T10:00:00.000Z");
  expect(latestDecision([newer, older])).toBe(newer);
  expect(latestDecision([older, newer])).toBe(newer);
});

test("history runs oldest first and names returns, rejections, system actors and over-limits", () => {
  const history = tripHistory(privateView(needsFixManual()));
  expect(history.map((entry) => [entry.kind, entry.actor, entry.system])).toEqual([
    ["submitted", "Fictional Stage Four Driver", false],
    ["rejected", null, true],
    ["returned", "Fictional Stage Four Dispatcher", false],
  ]);
  expect(history[0]?.titleKey).toBe("history_submitted");
  expect(history[2]).toMatchObject({
    quote: needsFixReason,
    reasonKeys: ["reasonOther", "code_manual_evidence_missing"],
  });

  // A telemetry receipt and a later revision; a same-instant decision follows the submission.
  const reconciled = privateView(reconciledAccepted());
  const revision = privateView(needsFixManual()).manualRevision;
  if (!revision) throw new Error("MISSING_REVISION");
  reconciled.manualRevision = { ...revision, number: 2, submittedAt: "2026-11-10T19:00:00.000Z" };
  reconciled.decisions = [
    decision("accepted", "2026-11-10T19:00:00.000Z", {
      reviewer: fixtureReviewer,
      reviewerId: fixtureReviewer.id,
      acceptedOverLimits: true,
      reasonCodes: ["rule_mass_exceeded", "accepted_over_limits"],
    }),
  ];
  const merged = tripHistory(reconciled);
  expect(merged.map((entry) => entry.kind)).toEqual(["telemetry", "submitted", "accepted"]);
  expect(merged[1]).toMatchObject({ titleKey: "revisionSubmitted", number: 2 });
  expect(merged[2]).toMatchObject({ overLimits: true, reasonKeys: ["code_rule_mass_exceeded"] });

  // A staff rejection of a trip without a manual report is a rejection, not a return.
  expect(tripHistory(privateView(returnedTrip())).map((entry) => entry.kind)).toEqual([
    "telemetry",
    "rejected",
  ]);
  expect(tripHistory(privateView(olderPrivate("private-recorded-telemetry")))).toEqual([]);
});

test("unknown recorded values say whether telemetry recorded the trip at all", () => {
  expect(unknownHintKey(privateView(manualUnknown()).summary)).toBe("unknownHelpNoTelemetry");
  expect(unknownHintKey(privateView(telemetryWithEvent()).summary)).toBe("unknownHelpTelemetry");
  expect(recordedValueKey("telemetryMode", "haulmp")).toBe("telemetryMode_haulmp");
  expect(recordedValueKey("telemetryJob", "unknown")).toBeNull();
  expect(recordedValueKey("telemetryAudit", undefined)).toBeNull();
  expect(recordedValueKey("telemetryAudit", "not-qualified")).toBe("telemetryAudit_not-qualified");
});

test("every VTC-158 trip page key exists in both languages and is translated", () => {
  const pattern =
    /^(tripTitle|tripNumber|completedOn|driverName|fixReport|status_|summaryRegion|tile|distance(By|No|Unknown)|credited|next_|quoted|fact(From|To|Trailer|Started|Completed|Damage)$|damageOfCargo|eventNone|reported(Time|InfoLabel)|unknown(InfoLabel|Help)|history_|reasonOther|code_accepted_over_limits|technical|tripId|pendingProposalId|associateConfirmText|correctionConfirmText)/;
  const keys = Object.keys(tripTranslations.en).filter((key) => pattern.test(key)) as Array<
    keyof typeof tripTranslations.en
  >;
  expect(keys.length).toBeGreaterThan(70);
  for (const key of keys) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).not.toBe(tripTranslations.en[key]);
  }
  expect(Object.keys(tripTranslations.ru).sort()).toEqual(Object.keys(tripTranslations.en).sort());
});
