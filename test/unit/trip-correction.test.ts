import { expect, test } from "vitest";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import {
  correctableFacts,
  correctionBody,
  decimalScale,
  draftChanges,
  initialDraft,
  oldFormatProposal,
  proposedChanges,
  unconfirmedFields,
} from "../../apps/web/src/features/trips/correction-model.ts";
import type { DTO } from "../../apps/web/src/features/trips/transport.ts";
import {
  awaitingFix,
  canCorrect,
  nextStep,
  revisableReportId,
  tripBanner,
  tripHistory,
} from "../../apps/web/src/features/trips/trip-page-model.ts";
import {
  acceptedManualCorrectable,
  correctionProposal,
  needsFixManual,
  needsFixTelemetry,
  pendingCorrection,
  returnedTrip,
  tripPrivate,
} from "../e2e/support/trip-page-fixtures.ts";

// VTC-169 driver corrections: pure page models over fictional fixtures.
const cargo = "63000000-0000-4000-8000-000000000021";
const fact = (
  field: DTO["TripCorrectionField"],
  reported: string | null = null,
): DTO["TripCorrectionFact"] => ({ field, reported, reasonCode: null, sourceCode: null });

test("correctable facts keep display order and only telemetry marks them unconfirmed", () => {
  const telemetry = tripPrivate(needsFixTelemetry());
  expect(correctableFacts(telemetry.correction).map((f) => f.field)).toEqual([
    "actualDistanceM",
    "cargoId",
  ]);
  expect([...unconfirmedFields(telemetry)]).toEqual(["actualDistanceM", "cargoId"]);
  expect(correctableFacts(null)).toEqual([]);
  // A manual report's values are the driver's own: correctable once accepted, never "unconfirmed".
  const manual = tripPrivate(acceptedManualCorrectable());
  expect(correctableFacts(manual.correction)).toHaveLength(2);
  expect(unconfirmedFields(manual).size).toBe(0);
});

test("the draft starts from the reported values in kilometres, tonnes and local minutes", () => {
  const facts = [
    fact("actualDistanceM", "251000.5"),
    fact("cargoMassKg", "18000"),
    fact("actualStartAt", "2026-11-10T10:00:42.000Z"),
    fact("cargoId"),
    fact("originCityId", cargo),
  ];
  expect(initialDraft(facts, "Europe/Moscow")).toEqual({
    actualDistanceM: "251.0005",
    cargoMassKg: "18",
    actualStartAt: "2026-11-10T13:00",
    originCityId: cargo,
  });
});

test("draft changes convert exactly to wire units and explain invalid values per field", () => {
  const facts = [
    fact("actualDistanceM"),
    fact("cargoMassKg"),
    fact("actualStartAt", "2026-11-10T10:00:42.000Z"),
    fact("actualCompletedAt"),
    fact("cargoId"),
  ];
  expect(decimalScale("312.0005", 3)).toBe("312000.5");
  expect(decimalScale("0.019", 3)).toBe("19");
  const valid = draftChanges(
    {
      actualDistanceM: "312.0005",
      cargoMassKg: " 19.5 ",
      // An unchanged minute keeps the reported instant with its seconds.
      actualStartAt: "2026-11-10T10:00",
      actualCompletedAt: "2026-11-10T18:30",
      cargoId: cargo,
    },
    facts,
    "UTC",
  );
  expect(valid).toEqual({
    errors: {},
    changes: {
      actualDistanceM: "312000.5",
      cargoMassKg: "19500",
      actualStartAt: "2026-11-10T10:00:42.000Z",
      actualCompletedAt: "2026-11-10T18:30:00.000Z",
      cargoId: cargo,
    },
  });
  const invalid = draftChanges(
    {
      actualDistanceM: "0",
      cargoMassKg: "twelve",
      actualStartAt: "2026-11-10T10:00",
      actualCompletedAt: "2026-11-10T09:00",
    },
    facts,
    "UTC",
  );
  expect(invalid.errors).toEqual({
    actualDistanceM: "correctionNumber",
    cargoMassKg: "correctionNumber",
    actualCompletedAt: "correctionOrder",
  });
  expect(invalid.changes).toEqual({ actualStartAt: "2026-11-10T10:00:42.000Z" });
  // A Russian decimal comma reads like a point.
  expect(draftChanges({ cargoMassKg: "12,5" }, facts, "UTC").changes).toEqual({
    cargoMassKg: "12500",
  });
  // Empty fields and facts the server did not offer are never sent.
  expect(draftChanges({ cargoId: " ", destinationCityId: cargo }, facts, "UTC").changes).toEqual(
    {},
  );
});

test("the command needs a reason and a changed fact and cites the given screenshots", () => {
  const evidence = ["43000000-0000-4000-8000-000000000030"];
  expect(correctionBody({ actualDistanceM: "1" }, "  ", [])).toBeNull();
  expect(correctionBody({}, "Fictional reason", [])).toBeNull();
  expect(correctionBody({ actualDistanceM: "1" }, "x".repeat(2049), [])).toBeNull();
  expect(correctionBody({ actualDistanceM: "1" }, " Fictional reason ", evidence)).toEqual({
    actualDistanceM: "1",
    reason: "Fictional reason",
    evidenceIds: evidence,
  });
});

test("only a pending proposal's values mark the page; old text requests are recognized", () => {
  const proposal = correctionProposal(cargo);
  expect(proposedChanges(proposal)).toEqual({ actualDistanceM: "312000", cargoId: cargo });
  expect(proposedChanges({ ...proposal, state: "approved" })).toEqual({});
  expect(proposedChanges(null)).toEqual({});
  expect(oldFormatProposal(proposal)).toBe(false);
  const old = {
    ...proposal,
    kind: "correction_request" as const,
    changes: null,
    correctionRequestId: "41500000-0000-4000-8000-000000000390",
  };
  expect(oldFormatProposal(old)).toBe(true);
  expect(oldFormatProposal({ ...old, correctionRequestId: null })).toBe(false);
});

test("a return for fixes needs the driver; a rejection without it is final (D2)", () => {
  const returned = tripPrivate(needsFixTelemetry());
  expect(awaitingFix(returned)).toBe(true);
  expect(canCorrect(returned, fixtureId)).toBe(true);
  expect(canCorrect(returned, "41000000-0000-4000-8000-000000000099")).toBe(false);
  expect(nextStep(returned, { owner: true, staff: false })).toMatchObject({
    titleKey: "next_fix",
    noteKey: "next_fix_telemetry_note",
    attention: true,
  });
  expect(nextStep(tripPrivate(pendingCorrection()), { owner: true, staff: false })?.titleKey).toBe(
    "next_correction",
  );
  // A report returned for fixes is revised through the report.
  const report = tripPrivate(needsFixManual());
  expect(awaitingFix(report)).toBe(true);
  expect(revisableReportId(report, fixtureId)).not.toBeNull();
  // Earlier human rejections carry no return code: final, nothing to revise or correct.
  const final = tripPrivate(returnedTrip());
  expect(awaitingFix(final)).toBe(false);
  expect(revisableReportId(final, fixtureId)).toBeNull();
  expect(canCorrect(final, fixtureId)).toBe(false);
  const legacy = tripPrivate(needsFixManual());
  for (const decision of legacy.decisions)
    decision.reasonCodes = decision.reasonCodes.filter((code) => code !== "returned_for_fixes");
  expect(awaitingFix(legacy)).toBe(false);
  expect(revisableReportId(legacy, fixtureId)).toBeNull();
});

test("the status banner carries the driver's fix and the correction under review (variant A)", () => {
  const owner = { owner: true, staff: false };
  expect(tripBanner(tripPrivate(needsFixTelemetry()), owner)).toMatchObject({
    status: "needs_fix",
    tone: "warn",
    noteKey: "next_fix_telemetry_note",
    action: "fix",
  });
  // Staff read the same status without the driver's action.
  expect(tripBanner(tripPrivate(needsFixTelemetry()), { owner: false, staff: true })).toMatchObject(
    {
      status: "needs_fix",
      noteKey: "next_fix_staff_note",
      action: null,
    },
  );
  expect(tripBanner(tripPrivate(pendingCorrection()), owner)).toMatchObject({
    status: "pending_review",
    noteKey: "next_correction_note",
    action: null,
  });
  // A final rejection is no fix; an accepted report keeps no banner while it stays correctable.
  expect(tripBanner(tripPrivate(returnedTrip()), owner)).toMatchObject({
    status: "rejected",
    action: null,
  });
  expect(tripBanner(tripPrivate(acceptedManualCorrectable()), owner)).toBeNull();
});

test("history lists the return and the driver's proposed correction in time order", () => {
  const view = tripPrivate(pendingCorrection());
  const proposal = correctionProposal(cargo);
  const kinds = tripHistory(view, [proposal]).map((entry) => entry.kind);
  expect(kinds.slice(-2)).toEqual(["returned", "proposed"]);
  // A proposal without values or by someone else is not the driver's correction.
  expect(
    tripHistory(view, [
      { ...proposal, changes: null },
      { ...proposal, authorId: "41500000-0000-4000-8000-000000000003" },
    ]).map((entry) => entry.kind),
  ).not.toContain("proposed");
});
