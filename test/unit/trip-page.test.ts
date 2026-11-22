import { expect, test } from "vitest";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { type DTO, schema } from "../../apps/web/src/features/trips/transport.ts";
import {
  acceptedLine,
  associationConsequence,
  awaitingFix,
  canRevise,
  cargoLabels,
  creditState,
  damageValue,
  distanceNote,
  eventCandidates,
  formatRounded,
  formatRoundedQuantity,
  latestDecision,
  localDay,
  nextStep,
  onTripDays,
  qualificationSummary,
  reasonLabelKey,
  reasonLabelKeys,
  recordedValueKey,
  reportedDamage,
  revisableReportId,
  roundedQuantity,
  routeMatches,
  sourceOutcomeKey,
  tripBanner,
  tripDays,
  tripDuration,
  tripHistory,
  tripStatus,
  tripTimes,
  unknownHintKey,
} from "../../apps/web/src/features/trips/trip-page-model.ts";
import {
  acceptedTelemetry,
  asOtherMember,
  eventMember,
  eventPage,
  fictionalEvent,
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
  returnedReason,
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

test("trip status names every decision and outcome, and a returned report only when awaiting a fix", () => {
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

/** A legacy manual revision: resolved catalog IDs and no report behind it. */
const legacyRevision = () =>
  ({
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
  }) as unknown as DTO["ManualRevision"];

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
  privateView(legacy).manualRevision = legacyRevision();
  expect(canRevise(legacy.data, fixtureId)).toBe(false);
  expect(canRevise(otherSummary().data, otherOwnerId)).toBe(false);
});

test("the next step serves the author, staff and nobody else, with the latest decision reason", () => {
  const returned = needsFixManual();
  const author = nextStep(returned.data, { owner: true, staff: false });
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
  expect(nextStep(returned.data, { owner: true, staff: false })?.reason).toBe(needsFixReason);
  expect(nextStep(returned.data, { owner: false, staff: false })).toBeNull();
  expect(nextStep(otherSummary().data, { owner: false, staff: true })).toBeNull();
  expect(nextStep(undefined, { owner: true, staff: true })).toBeNull();
  // Staff read a returned report as waiting for the driver, with the same decision details.
  expect(
    nextStep(asOtherMember(needsFixManual()).data, { owner: false, staff: true }),
  ).toMatchObject({
    titleKey: "next_fix_staff",
    noteKey: "next_fix_staff_note",
    attention: false,
    held: false,
    reviewer: "Fictional Stage Four Dispatcher",
    reason: needsFixReason,
  });
  const legacyRejected = asOtherMember(needsFixManual());
  privateView(legacyRejected).manualRevision = legacyRevision();
  expect(nextStep(legacyRejected.data, { owner: false, staff: true })).toMatchObject({
    titleKey: "next_rejected",
    attention: false,
  });

  const pending = pendingManual();
  expect(nextStep(pending.data, { owner: true, staff: false })).toMatchObject({
    titleKey: "next_none",
    noteKey: "next_pending_note",
    attention: false,
    held: true,
    reasonKeys: ["code_manual_review_required", "reasonOther"],
  });
  expect(nextStep(pending.data, { owner: false, staff: true })).toMatchObject({
    titleKey: "next_pending_staff",
    attention: false,
  });
  // A staff owner is the author first.
  expect(nextStep(pending.data, { owner: true, staff: true })?.titleKey).toBe("next_none");
  privateView(pending).pendingProposalId = "41500000-0000-4000-8000-000000000390";
  expect(nextStep(pending.data, { owner: true, staff: false })?.titleKey).toBe("next_correction");
  expect(nextStep(reconciledAccepted().data, { owner: true, staff: false })?.titleKey).toBe(
    "next_none",
  );
  expect(nextStep(openTelemetry().data, { owner: true, staff: false })?.titleKey).toBe("next_open");
  const cancelled = openTelemetry();
  privateView(cancelled).summary.outcome = "cancelled";
  expect(nextStep(cancelled.data, { owner: true, staff: false })?.titleKey).toBe("next_cancelled");
  const unassessed = openTelemetry();
  privateView(unassessed).summary.outcome = "delivered";
  expect(nextStep(unassessed.data, { owner: true, staff: false })?.titleKey).toBe(
    "next_unassessed",
  );
  for (const view of [needsFixManual(), pendingManual(), openTelemetry(), reconciledAccepted()])
    for (const flags of [
      { owner: true, staff: false },
      { owner: false, staff: true },
    ]) {
      const step = nextStep(view.data, flags);
      expect(step?.attention).toBe(step?.titleKey === "next_fix");
    }
});

test("staff and the owner read one status, credit and history for a report awaiting a fix", () => {
  const envelope = asOtherMember(needsFixManual());
  const staffView = envelope.data;
  const own = privateView(envelope);
  expect(awaitingFix(staffView)).toBe(true);
  // Only the owner may act on it.
  expect(canRevise(staffView, fixtureId)).toBe(false);
  expect(canRevise(staffView, fixtureReviewer.id)).toBe(false);
  expect(canRevise(staffView, otherOwnerId)).toBe(true);
  expect(tripStatus(own.summary, awaitingFix(staffView))).toBe("needs_fix");
  expect(creditState(own.summary, awaitingFix(staffView)).valueKey).toBe("creditedNotYet");
  expect(nextStep(staffView, { owner: false, staff: true })).toMatchObject({
    titleKey: "next_fix_staff",
    attention: false,
  });
  // History agrees: the latest decision returned the report for fixes.
  expect(tripHistory(own).map((entry) => entry.kind)).toContain("returned");

  // No report behind the trip, a legacy revision, or a decision other than rejection.
  expect(awaitingFix(returnedTrip().data)).toBe(false);
  const legacy = needsFixManual();
  privateView(legacy).manualRevision = legacyRevision();
  expect(awaitingFix(legacy.data)).toBe(false);
  const accepted = needsFixManual();
  privateView(accepted).summary.decision = "accepted";
  expect(awaitingFix(accepted.data)).toBe(false);
  expect(awaitingFix(pendingManual().data)).toBe(false);
  expect(awaitingFix(otherSummary().data)).toBe(false);
  expect(awaitingFix(undefined)).toBe(false);
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
});

test("reported damage stands in only without an effective damage field and is marked", () => {
  const reported = privateView(needsFixManual()).manualRevision;
  // An explicit null from the server means unknown; the report does not override it.
  const unknown = privateView(manualUnknown()).effectiveFacts;
  expect(unknown && "cargoDamagePercent" in unknown && unknown.cargoDamagePercent).toBeNull();
  expect(reportedDamage(unknown, reported)).toBeNull();
  expect(reportedDamage(unknown, null)).toBeNull();
  expect(
    reportedDamage(privateView(manualUnknown("zero-damage")).effectiveFacts, reported),
  ).toEqual({ value: 0, reported: false });
  // Without the field, or without an effective fact, the report's damage is shown as reported.
  const absent = privateView(manualUnknown()).effectiveFacts;
  if (!absent) throw new Error("MISSING_FACTS");
  delete absent.cargoDamagePercent;
  expect(reportedDamage(absent, reported)).toEqual({ value: 12.5, reported: true });
  expect(reportedDamage(null, reported)).toEqual({ value: 12.5, reported: true });
  expect(reportedDamage(absent, null)).toBeNull();
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

  // A staff rejection of a legacy revision cannot be fixed, so it stays a rejection.
  const legacy = privateView(needsFixManual());
  legacy.manualRevision = legacyRevision();
  expect(tripHistory(legacy).map((entry) => [entry.kind, entry.titleKey])).toEqual([
    ["submitted", "history_submitted"],
    ["rejected", "history_rejected"],
    ["rejected", "history_rejected"],
  ]);

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

test("reported cargo labels list ADR, flags and groups once, in display order", () => {
  const base = {
    fragile: false,
    valuable: false,
    adr: { state: "none" },
    overweight: false,
    oversize: null,
    groups: [],
  } satisfies DTO["TripCargoClassification"];
  expect(cargoLabels(undefined)).toEqual([]);
  expect(cargoLabels(base)).toEqual([]);
  expect(
    cargoLabels({
      fragile: true,
      valuable: true,
      adr: { state: "class", class: 3 },
      overweight: true,
      oversize: true,
      groups: ["liquid", "fragile", "oversize", "refrigerated"],
    }),
  ).toEqual([
    { label: "adr", adrClass: 3 },
    { label: "fragile" },
    { label: "valuable" },
    { label: "overweight" },
    { label: "oversize" },
    { label: "liquid" },
    { label: "refrigerated" },
  ]);
  // A group without its flag still shows the label; an unmapped ADR value shows plain ADR.
  expect(
    cargoLabels({ ...base, adr: { state: "unsupported" }, groups: ["fragile", "oversize"] }),
  ).toEqual([{ label: "adrUnsupported" }, { label: "fragile" }, { label: "oversize" }]);
  for (const label of ["fragile", "valuable", "overweight", "oversize", "gooseneck"] as const) {
    const key = `cargoLabel_${label}` as const;
    expect(tripTranslations.ru[key]).not.toBe(tripTranslations.en[key]);
  }
});

test("every VTC-158 trip page key exists in both languages and is translated", () => {
  const pattern =
    /^(tripTitle|tripNumber|completedOn|driverName|fixReport|status_|summaryRegion|tile|distance(By|No|Unknown)|credited|next_|quoted|fact(From|To|Trailer|Started|Completed|Damage)$|damageOfCargo|eventNone|reported(Time|InfoLabel|ValueLabel|ValueHelp)|asideLabel|unknown(InfoLabel|Help)|history_|reasonOther|code_accepted_over_limits|technical|tripId|pendingProposalId|associateConfirmText|correctionConfirmText)/;
  const keys = Object.keys(tripTranslations.en).filter((key) => pattern.test(key)) as Array<
    keyof typeof tripTranslations.en
  >;
  expect(keys.length).toBeGreaterThan(70);
  for (const key of keys) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    if (key === "tripIdColumn") {
      expect(tripTranslations.ru[key]).toBe("ID");
      expect(tripTranslations.en[key]).toBe("ID");
    } else expect(tripTranslations.ru[key], key).not.toBe(tripTranslations.en[key]);
  }
  expect(Object.keys(tripTranslations.ru).sort()).toEqual(Object.keys(tripTranslations.en).sort());
});

// VTC-170 summary-first trip page model.
test("quantities round half up to whole kilometres and tenths of a tonne, never through zero", () => {
  expect(roundedQuantity("251129.8828125", "km")).toEqual({ value: "251", lessThan: false });
  expect(formatRounded("251129.8828125", "km", "ru")).toBe("251 км");
  expect(formatRounded("251129.8828125", "km", "en")).toBe("251 km");
  expect(roundedQuantity("500", "km")).toEqual({ value: "1", lessThan: false });
  expect(roundedQuantity("499", "km")).toEqual({ value: "1", lessThan: true });
  expect(formatRounded("499", "km", "en")).toBe("< 1 km");
  expect(roundedQuantity("0", "km")).toEqual({ value: "0", lessThan: false });
  expect(formatRounded("0", "km", "en")).toBe("0 km");
  expect(roundedQuantity(null, "km")).toBeNull();
  expect(formatRounded(null, "t", "ru")).toBeNull();
  expect(roundedQuantity("24856.900390625", "t")).toEqual({ value: "24.9", lessThan: false });
  expect(formatRounded("24856.900390625", "t", "ru")).toBe("24,9 т");
  expect(formatRounded("24856.900390625", "t", "en")).toBe("24.9 t");
  expect(roundedQuantity("24950", "t")).toEqual({ value: "25", lessThan: false });
  expect(formatRounded("24950", "t", "en")).toBe("25 t");
  expect(roundedQuantity("40", "t")).toEqual({ value: "0.1", lessThan: true });
  expect(formatRounded("40", "t", "en")).toBe("< 0.1 t");
  expect(formatRounded("40", "t", "ru")).toBe("< 0,1 т");
  expect(formatRounded("812400.5", "km", "en")).toBe("812 km");
  expect(formatRounded("1234567890", "km", "en")).toBe("1,234,568 km");
  expect(formatRounded("999500", "km", "en")).toBe("1,000 km");
  expect(formatRoundedQuantity({ value: "1", lessThan: true }, "km", "ru")).toBe("< 1 км");
});

test("the banner names every status that is not accepted, with one owner action at most", () => {
  expect(tripBanner(reconciledAccepted().data, { owner: true, staff: false })).toBeNull();
  expect(tripBanner(undefined, { owner: true, staff: false })).toBeNull();

  const fix = tripBanner(needsFixManual().data, { owner: true, staff: false });
  expect(fix).toEqual({
    status: "needs_fix",
    tone: "warn",
    counted: "notYet",
    noteKey: "next_fix_note",
    quote: needsFixReason,
    reasonKeys: ["reasonOther", "code_manual_evidence_missing"],
    heldKeys: [],
    actor: fixtureReviewer.nickname,
    system: false,
    at: "2026-11-12T10:31:00.000Z",
    action: "fix",
  });
  // Staff read the same status and decision, without the driver's action.
  expect(
    tripBanner(asOtherMember(needsFixManual()).data, { owner: false, staff: true }),
  ).toMatchObject({
    status: "needs_fix",
    noteKey: "next_fix_staff_note",
    quote: needsFixReason,
    actor: fixtureReviewer.nickname,
    action: null,
  });

  expect(tripBanner(returnedTrip().data, { owner: true, staff: false })).toMatchObject({
    status: "rejected",
    tone: "error",
    counted: "no",
    noteKey: "next_rejected_note",
    quote: returnedReason,
    actor: "Fictional Stage Four Dispatcher",
    system: false,
    at: "2026-11-11T10:00:00.000Z",
    action: null,
  });
  const system = returnedTrip();
  const [only] = privateView(system).decisions;
  if (!only) throw new Error("MISSING_DECISION");
  only.reviewer = null;
  only.reviewerId = null;
  only.reason = null;
  only.reasonCodes = ["rule_mass_exceeded"];
  expect(tripBanner(system.data, { owner: true, staff: false })).toMatchObject({
    actor: null,
    system: true,
    quote: null,
    reasonKeys: ["code_rule_mass_exceeded"],
  });

  const pending = pendingManual();
  privateView(pending).summary.submittedAt = "2026-11-11T09:00:00.000Z";
  expect(tripBanner(pending.data, { owner: true, staff: false })).toEqual({
    status: "pending_review",
    tone: "pending",
    counted: "notYet",
    noteKey: "next_pending_note",
    quote: null,
    reasonKeys: [],
    heldKeys: ["code_manual_review_required", "reasonOther"],
    actor: null,
    system: false,
    at: "2026-11-11T09:00:00.000Z",
    action: null,
  });
  expect(tripBanner(pendingManual().data, { owner: true, staff: false })?.at).toBeNull();
  expect(tripBanner(pending.data, { owner: false, staff: true })?.noteKey).toBe(
    "next_pending_staff_note",
  );

  expect(tripBanner(openTelemetry().data, { owner: true, staff: false })).toMatchObject({
    status: "in_progress",
    tone: "neutral",
    counted: "notYet",
    noteKey: "next_open_note",
    at: null,
    action: null,
  });
  const cancelled = openTelemetry();
  privateView(cancelled).summary.outcome = "cancelled";
  expect(tripBanner(cancelled.data, { owner: true, staff: false })).toMatchObject({
    status: "cancelled",
    counted: "no",
    noteKey: "next_cancelled_note",
  });
  const unassessed = openTelemetry();
  privateView(unassessed).summary.outcome = "delivered";
  expect(tripBanner(unassessed.data, { owner: true, staff: false })).toMatchObject({
    status: "unassessed",
    noteKey: "next_unassessed_note",
  });
  // A company summary has no next step; the banner still explains its status.
  const summary = otherSummary();
  (summary.data as DTO["TripSummary"]).decision = "pending_review";
  expect(tripBanner(summary.data, { owner: false, staff: false })).toMatchObject({
    noteKey: "next_pending_note",
    actor: null,
    action: null,
  });
});

test("an accepted trip has one counted line with the rounded distance and its acceptance", () => {
  expect(acceptedLine(acceptedTelemetry().data)).toEqual({
    distance: { value: "812", lessThan: false },
    game: "ets2",
    actor: fixtureReviewer.nickname,
    system: false,
    at: "2026-11-11T08:15:00.000Z",
  });
  const unknown = acceptedTelemetry();
  privateView(unknown).summary.actualDistanceM = null;
  expect(acceptedLine(unknown.data)?.distance).toBeNull();
  // An older view without decisions and another member's summary name nobody.
  expect(acceptedLine(reconciledAccepted().data)).toMatchObject({ actor: null, at: null });
  expect(acceptedLine(otherSummary().data)).toMatchObject({
    distance: { value: "812", lessThan: false },
    actor: null,
    at: null,
  });
  // A later system rejection does not replace the acceptance shown on the line.
  const mixed = acceptedTelemetry();
  privateView(mixed).decisions.push(decision("rejected", "2026-11-12T10:00:00.000Z"));
  expect(acceptedLine(mixed.data)?.at).toBe("2026-11-11T08:15:00.000Z");
  expect(acceptedLine(needsFixManual().data)).toBeNull();
  expect(acceptedLine(undefined)).toBeNull();
});

test("the collapsed check counts passed limits and takes its tone from the worst result", () => {
  expect(qualificationSummary(privateView(telemetryWithEvent()).qualificationCheck)).toEqual({
    passed: 4,
    total: 5,
    tone: "error",
  });
  const check = privateView(telemetryWithEvent()).qualificationCheck;
  if (!check) throw new Error("MISSING_CHECK");
  const passing = {
    ...check,
    rules: check.rules.map((rule) => ({ ...rule, result: "pass" as const })),
  } as DTO["QualificationCheck"];
  expect(qualificationSummary(passing)).toEqual({ passed: 5, total: 5, tone: "ok" });
  const unknown = {
    ...passing,
    rules: passing.rules.map((rule, i) =>
      i === 0 ? { ...rule, result: "unknown" as const } : rule,
    ),
  } as DTO["QualificationCheck"];
  expect(qualificationSummary(unknown)).toEqual({ passed: 4, total: 5, tone: "warn" });
  expect(qualificationSummary(privateView(manualUnknown()).qualificationCheck)).toBeNull();
  expect(qualificationSummary(null)).toBeNull();
});

test("duration and trip days follow the actual times and the display zone", () => {
  const times = {
    startedAt: "2026-11-10T14:30:00.000Z",
    completedAt: "2026-11-10T16:02:00.000Z",
    reported: false,
  };
  expect(tripDuration(times)).toBe(92);
  expect(tripDuration({ ...times, completedAt: null })).toBeNull();
  expect(tripDuration({ ...times, completedAt: "2026-11-10T14:00:00.000Z" })).toBeNull();
  expect(tripDuration(null)).toBeNull();
  // 23:30 to 01:02 in Tokyo crosses midnight; in UTC the trip stays on one day.
  expect(tripDays(times, "UTC")).toEqual(["2026-11-10"]);
  expect(tripDays(times, "Asia/Tokyo")).toEqual(["2026-11-10", "2026-11-11"]);
  expect(tripDays({ ...times, startedAt: null }, "UTC")).toEqual(["2026-11-10"]);
  expect(tripDays({ ...times, completedAt: "2026-11-12T01:00:00.000Z" }, "UTC")).toEqual([
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
  ]);
  expect(tripDays(null, "UTC")).toBeNull();
  expect(tripDays({ startedAt: null, completedAt: null, reported: true }, "UTC")).toBeNull();
  expect(localDay("2026-11-10T15:00:00.000Z", "Asia/Tokyo")).toBe("2026-11-11");
  expect(localDay("not a time", "UTC")).toBeNull();
});

test("event candidates are scheduled events of the same game, newest first, matched by ID", () => {
  const days = ["2026-11-10"];
  const sameDay = fictionalEvent(1, "2026-11-10T09:00:00.000Z", { sameRoute: true });
  const sameDayOther = fictionalEvent(2, "2026-11-10T20:00:00.000Z");
  const older = fictionalEvent(3, "2026-11-01T09:00:00.000Z");
  const otherGame = fictionalEvent(4, "2026-11-10T10:00:00.000Z", { game: "ats" });
  const cancelled = fictionalEvent(5, "2026-11-10T11:00:00.000Z", { status: "cancelled" });
  const candidates = eventCandidates([older, sameDay, otherGame, sameDayOther, cancelled], "ets2");
  expect(candidates.map((event) => event.title)).toEqual([
    sameDayOther.title,
    sameDay.title,
    older.title,
  ]);
  expect(
    candidates.filter((event) => onTripDays(event, days, "UTC")).map((event) => event.title),
  ).toEqual([sameDayOther.title, sameDay.title]);
  // 20:00 UTC is the next day in Tokyo.
  expect(onTripDays(sameDayOther, days, "Asia/Tokyo")).toBe(false);

  const trip = privateView(acceptedTelemetry()).summary;
  expect(routeMatches(sameDay, trip)).toBe(true);
  expect(routeMatches(sameDayOther, trip)).toBe(false);
  // Labels never decide a match; canonical IDs do.
  const relabeled = structuredClone(sameDay);
  if (!relabeled.origin || !relabeled.destination) throw new Error("MISSING_ROUTE");
  relabeled.origin.label = "Another label";
  expect(routeMatches(relabeled, trip)).toBe(true);
  relabeled.destination.entityId = "41500000-0000-4000-8000-000000000399";
  expect(routeMatches(relabeled, trip)).toBe(false);
  expect(routeMatches(sameDay, { origin: null, destination: trip.destination })).toBe(false);

  for (const page of [eventPage([sameDay, older], "cursor-2"), eventPage([])])
    expect(schema("EnvelopeListEventPublic").safeParse(page).success).toBe(true);
  for (const attendance of ["unconfirmed", "attended", "not_attended"] as const)
    expect(
      schema("EnvelopeEventMember").safeParse(eventMember(sameDay, attendance, "participating"))
        .success,
    ).toBe(true);
});

test("the link consequence follows the trip decision and the confirmed attendance only", () => {
  const event = fictionalEvent(1, "2026-11-10T09:00:00.000Z");
  const member = (
    attendance: DTO["EventMember"]["myAttendance"],
    response: DTO["Rsvp"]["response"],
  ) => eventMember(event, attendance, response).data;
  for (const decided of ["accepted", "rejected"] as const)
    expect(associationConsequence(decided, null)).toEqual({
      linkKey: "eventLinkReviewed",
      attendanceKey: null,
    });
  for (const open of ["pending_review", "unassessed"] as const)
    expect(associationConsequence(open, undefined).linkKey).toBe("eventLinkImmediate");
  expect(associationConsequence("pending_review", member("attended", "unanswered"))).toEqual({
    linkKey: "eventLinkImmediate",
    attendanceKey: "eventAttended",
  });
  expect(
    associationConsequence("accepted", member("not_attended", "participating")).attendanceKey,
  ).toBe("eventNotAttended");
  // A signup is not attendance.
  expect(
    associationConsequence("pending_review", member("unconfirmed", "participating")).attendanceKey,
  ).toBe("eventSignedUp");
  for (const response of ["unanswered", "declined"] as const)
    expect(
      associationConsequence("pending_review", member("unconfirmed", response)).attendanceKey,
    ).toBe("eventNotSignedUp");
});

test("every VTC-170 trip page key exists in both languages and is translated", () => {
  const added = [
    "moreActions",
    "menuLinkEvent",
    "menuEditReport",
    "menuRefresh",
    "menuCopyLink",
    "menuOpenDispatch",
    "linkCopied",
    "linkCopyFailed",
    "statusRegion",
    "bannerNotYet",
    "bannerNo",
    "bannerSubmitted",
    "acceptedLine",
    "acceptedLineNoDistance",
    "routeRegion",
    "stripMass",
    "durationMinutes",
    "durationHours",
    "durationHoursMinutes",
    "cargoTrailerTitle",
    "cargoProperties",
    "conditionsTitle",
    "eventLinkAction",
    "eventChangeAction",
    "qualificationTitle",
    "qualificationRules",
    "showRules",
    "hideRules",
    "staffTitle",
    "staffHint",
    "timesInZone",
    "dataInfoLabel",
    "dataTitle",
    "dataTelemetry",
    "dataTelemetryNoDistance",
    "dataManual",
    "dataNoManual",
    "eventDialogTitle",
    "eventTabsLabel",
    "eventTabDay",
    "eventTabPast",
    "eventRouteMatches",
    "eventCurrent",
    "eventPartial",
    "eventLoadMore",
    "eventEmptyDay",
    "eventEmptyPast",
    "eventEmptyLoaded",
    "eventHelpLabel",
    "eventHelpTitle",
    "eventLinkReviewed",
    "eventLinkImmediate",
    "eventAttended",
    "eventNotAttended",
    "eventSignedUp",
    "eventNotSignedUp",
    "eventLinkedDone",
    "eventSentDone",
    "closeDialog",
  ] as const;
  for (const key of added) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).not.toBe(tripTranslations.en[key]);
  }
  expect(tripTranslations.en.qualificationRules).toBe("Rules: {{passed}} of {{total}}");
  expect(tripTranslations.ru.qualificationRules).toBe("Правила: {{passed}} из {{total}}");
  // Keys VTC-169 builds on stay in place even where this page no longer renders them.
  for (const key of ["tileCredited", "tileNext", "next_fix", "asideLabel", "fixReport"] as const)
    expect(tripTranslations.en[key], key).toBeTruthy();
});
