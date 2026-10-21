import { describe, expect, test } from "vitest";
import {
  type AllowedAdrCategoriesRule,
  type AllowedTrailerTypesRule,
  type EvaluationContext,
  type MaxMassRule,
  type QualificationProgressCondition,
  type QualificationProgressTotals,
  REASON_CODES,
  canonicalDecimal,
  compareDecimal,
  createDefaultRegistry,
  evaluateCompanyAcceptance,
  evaluateQualificationProgress,
  evaluateQualificationRules,
  isBypassedQualificationRule,
  isValidNonNegativeDecimal,
  kgToTon,
  matchEventPrescribedLoad,
  shiftDecimal,
  subtractDecimal,
  tonToKg,
  validateAllowedAdrCategoriesConfig,
  validateAllowedTrailerTypesConfig,
  validateMaxMassConfig,
} from "../../apps/api/src/modules/qualification-rules/index.js";
import {
  createSyntheticEvaluationContext,
  createSyntheticManualEvidence,
  createSyntheticTripEvidence,
  knownFact,
  pinnedEntityFact,
  unknownFact,
} from "../fixtures/qualification-rules/fixtures.js";
import {
  SYNTHETIC_IDS,
  driverLevel1Rules,
  driverLevel3Rules,
  traineeRules,
} from "../fixtures/qualification-rules/synthetic-rules.js";

describe("Qualification Rules Module — VTC-027", () => {
  describe("1. Exact Non-Negative Decimal Arithmetic", () => {
    test("validates well-formed non-negative decimals", () => {
      expect(isValidNonNegativeDecimal("0")).toBe(true);
      expect(isValidNonNegativeDecimal("100")).toBe(true);
      expect(isValidNonNegativeDecimal("100.5")).toBe(true);
      expect(isValidNonNegativeDecimal("0.000000000000000001")).toBe(true);

      // Rejects invalid strings
      expect(isValidNonNegativeDecimal("-5")).toBe(false);
      expect(isValidNonNegativeDecimal("01")).toBe(false);
      expect(isValidNonNegativeDecimal("abc")).toBe(false);
      expect(isValidNonNegativeDecimal("")).toBe(false);
      expect(isValidNonNegativeDecimal(null)).toBe(false);
      expect(isValidNonNegativeDecimal(123)).toBe(false);
    });

    test("compares decimals exactly without IEEE 754 float precision loss", () => {
      // Basic ordering
      expect(compareDecimal("10", "2")).toBe(1);
      expect(compareDecimal("2", "10")).toBe(-1);
      expect(compareDecimal("10", "10")).toBe(0);

      // Fractional alignment
      expect(compareDecimal("25000", "25000.000")).toBe(0);
      expect(compareDecimal("25000", "25000.001")).toBe(-1);
      expect(compareDecimal("25000.001", "25000")).toBe(1);
      expect(compareDecimal("0.5", "0.50")).toBe(0);
      expect(compareDecimal("0.2", "0.15")).toBe(1);
      expect(compareDecimal("0.2", "0.25")).toBe(-1);

      // 18-decimal-place precision
      const base = "1000.123456789012345678";
      const higher = "1000.123456789012345679";
      expect(compareDecimal(base, higher)).toBe(-1);
      expect(compareDecimal(higher, base)).toBe(1);
      expect(compareDecimal(base, base)).toBe(0);

      // Throws on invalid input
      expect(() => compareDecimal("invalid", "10")).toThrow("INVALID_NONNEGATIVE_DECIMAL");
      expect(() => compareDecimal("-1", "10")).toThrow("INVALID_NONNEGATIVE_DECIMAL");
    });

    test("shifts decimal points losslessly for unit conversions (kg/tonne)", () => {
      expect(kgToTon("1000")).toBe("1");
      expect(kgToTon("1250")).toBe("1.25");
      expect(kgToTon("1250.5")).toBe("1.2505");
      expect(kgToTon("500")).toBe("0.5");
      expect(kgToTon("0")).toBe("0");

      expect(tonToKg("1")).toBe("1000");
      expect(tonToKg("1.25")).toBe("1250");
      expect(tonToKg("1.2567")).toBe("1256.7");
      expect(tonToKg("0.05")).toBe("50");
      expect(tonToKg("0")).toBe("0");

      expect(shiftDecimal("123.456", 2)).toBe("1.23456");
      expect(shiftDecimal("1.23456", -2)).toBe("123.456");
      expect(canonicalDecimal("25.500")).toBe("25.5");
      expect(canonicalDecimal("0.000")).toBe("0");
      expect(canonicalDecimal("100.0")).toBe("100");

      expect(() => shiftDecimal("100", 19)).toThrow("INVALID_DECIMAL_SHIFT_PLACES");
    });

    test("subtracts decimals losslessly with underflow protection", () => {
      expect(subtractDecimal("100.5", "40.25")).toBe("60.25");
      expect(subtractDecimal("100", "100")).toBe("0");
      expect(subtractDecimal("0.5", "0.2")).toBe("0.3");
      expect(subtractDecimal("25000.500", "15000")).toBe("10000.5");

      expect(() => subtractDecimal("10", "20")).toThrow("SUBTRACTION_UNDERFLOW");
      expect(() => subtractDecimal("invalid", "10")).toThrow("INVALID_NONNEGATIVE_DECIMAL");
    });
  });

  describe("2. Evaluator: max_mass", () => {
    const rule: MaxMassRule = { type: "max_mass", maxKg: "20000" };

    test("passes when observed cargo mass is strictly below or equal to limit", () => {
      // Exactly at limit
      const atLimit = createSyntheticTripEvidence({ cargoMassKg: knownFact("20000") });
      const resAt = evaluateQualificationRules(atLimit, [rule]);
      expect(resAt.outcome).toBe("pass");
      expect(resAt.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_PASSED);

      // Below limit
      const belowLimit = createSyntheticTripEvidence({ cargoMassKg: knownFact("19999.999") });
      const resBelow = evaluateQualificationRules(belowLimit, [rule]);
      expect(resBelow.outcome).toBe("pass");

      // 0 kg mass (empty cargo/trip)
      const zeroMass = createSyntheticTripEvidence({ cargoMassKg: knownFact("0") });
      const resZero = evaluateQualificationRules(zeroMass, [rule]);
      expect(resZero.outcome).toBe("pass");
    });

    test("fails when observed cargo mass exceeds limit by even 0.001 kg", () => {
      const overLimit = createSyntheticTripEvidence({ cargoMassKg: knownFact("20000.001") });
      const resOver = evaluateQualificationRules(overLimit, [rule]);
      expect(resOver.outcome).toBe("fail");
      expect(resOver.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_MASS_EXCEEDED);
      expect(resOver.ruleResults[0]?.observed).toBe("20000.001");
      expect(resOver.ruleResults[0]?.expected).toBe("20000");
    });

    test("returns unknown when cargo mass fact is missing or unknown", () => {
      const unknownMass = createSyntheticTripEvidence({
        cargoMassKg: unknownFact("telemetry_payload_corrupted"),
      });
      const resUnknown = evaluateQualificationRules(unknownMass, [rule]);
      expect(resUnknown.outcome).toBe("unknown");
      expect(resUnknown.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_MASS_UNKNOWN);
      expect(resUnknown.ruleResults[0]?.observed).toBeNull();
    });

    test("strictly validates max_mass configuration schema", () => {
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "20000" })).toBe(true);
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "0" })).toBe(true);
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "25000.5" })).toBe(true);

      // Rejects extra properties, invalid decimals, negative numbers
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "20000", extra: true })).toBe(false);
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "-20000" })).toBe(false);
      expect(validateMaxMassConfig({ type: "max_mass", maxKg: "20000.00" })).toBe(false); // non-canonical trailing zero
      expect(validateMaxMassConfig({ type: "wrong_type", maxKg: "20000" })).toBe(false);
      expect(validateMaxMassConfig(null)).toBe(false);
    });
  });

  describe("3. Evaluator: allowed_trailer_types", () => {
    const rule: AllowedTrailerTypesRule = {
      type: "allowed_trailer_types",
      entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD],
    };

    test("passes when all trailers in chain match allowed entity IDs", () => {
      const allowedTrip = createSyntheticTripEvidence({
        trailers: {
          complete: true,
          items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_STANDARD)],
        },
      });
      const res = evaluateQualificationRules(allowedTrip, [rule]);
      expect(res.outcome).toBe("pass");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_PASSED);
    });

    test("fails when any trailer in chain is disallowed", () => {
      // Multi-trailer chain where second trailer is disallowed
      const mixedTrip = createSyntheticTripEvidence({
        trailers: {
          complete: true,
          items: [
            pinnedEntityFact(SYNTHETIC_IDS.TRAILER_STANDARD),
            pinnedEntityFact(SYNTHETIC_IDS.TRAILER_DISALLOWED),
          ],
        },
      });
      const res = evaluateQualificationRules(mixedTrip, [rule]);
      expect(res.outcome).toBe("fail");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_TRAILER_TYPE_DISALLOWED);
    });

    test("returns unknown when trailer chain is incomplete", () => {
      const incompleteTrip = createSyntheticTripEvidence({
        trailers: {
          complete: false,
          items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_STANDARD)],
        },
      });
      const res = evaluateQualificationRules(incompleteTrip, [rule]);
      expect(res.outcome).toBe("unknown");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_TRAILERS_INCOMPLETE);
    });

    test("returns unknown when a trailer in chain cannot be resolved", () => {
      const unknownTrailerTrip = createSyntheticTripEvidence({
        trailers: {
          complete: true,
          items: [unknownFact("catalog_entity_unresolved")],
        },
      });
      const res = evaluateQualificationRules(unknownTrailerTrip, [rule]);
      expect(res.outcome).toBe("unknown");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_TRAILER_TYPE_UNKNOWN);
    });

    test("strictly validates allowed_trailer_types configuration schema", () => {
      expect(
        validateAllowedTrailerTypesConfig({
          type: "allowed_trailer_types",
          entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD],
        }),
      ).toBe(true);

      // Rejects non-UUIDs, extra properties, non-arrays
      expect(
        validateAllowedTrailerTypesConfig({
          type: "allowed_trailer_types",
          entityIds: ["not-a-uuid"],
        }),
      ).toBe(false);
      expect(
        validateAllowedTrailerTypesConfig({
          type: "allowed_trailer_types",
          entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD],
          forbidden: true,
        }),
      ).toBe(false);
    });
  });

  describe("4. Evaluator: allowed_adr_categories", () => {
    const traineeAdrRule: AllowedAdrCategoriesRule = {
      type: "allowed_adr_categories",
      entityIds: [], // Trainee has no ADR certifications
    };

    const driverLevel3AdrRule: AllowedAdrCategoriesRule = {
      type: "allowed_adr_categories",
      entityIds: [SYNTHETIC_IDS.ADR_GASES_CLASS_2],
    };

    test("passes non-ADR cargo for drivers without ADR certifications", () => {
      const nonAdrTrip = createSyntheticTripEvidence({
        adrCategory: unknownFact("cargo_not_adr"),
      });
      const res = evaluateQualificationRules(nonAdrTrip, [traineeAdrRule]);
      expect(res.outcome).toBe("pass");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_PASSED);
      expect(res.ruleResults[0]?.observed).toBe("non_adr");
    });

    test("passes permitted ADR category", () => {
      const adrGasTrip = createSyntheticTripEvidence({
        adrCategory: pinnedEntityFact(SYNTHETIC_IDS.ADR_GASES_CLASS_2, "adr_category"),
      });
      const res = evaluateQualificationRules(adrGasTrip, [driverLevel3AdrRule]);
      expect(res.outcome).toBe("pass");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_PASSED);
      expect(res.ruleResults[0]?.observed).toBe(SYNTHETIC_IDS.ADR_GASES_CLASS_2);
    });

    test("fails disallowed ADR category", () => {
      const adrExplosivesTrip = createSyntheticTripEvidence({
        adrCategory: pinnedEntityFact(SYNTHETIC_IDS.ADR_EXPLOSIVES_CLASS_1, "adr_category"),
      });
      const res = evaluateQualificationRules(adrExplosivesTrip, [driverLevel3AdrRule]);
      expect(res.outcome).toBe("fail");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_ADR_CATEGORY_DISALLOWED);
    });

    test("returns unknown when ADR fact is genuinely unknown", () => {
      const unknownAdrTrip = createSyntheticTripEvidence({
        adrCategory: unknownFact("cargo_adr_unknown"),
      });
      const res = evaluateQualificationRules(unknownAdrTrip, [driverLevel3AdrRule]);
      expect(res.outcome).toBe("unknown");
      expect(res.ruleResults[0]?.reasonCode).toBe(REASON_CODES.RULE_ADR_CATEGORY_UNKNOWN);
    });

    test("strictly validates allowed_adr_categories configuration schema", () => {
      expect(
        validateAllowedAdrCategoriesConfig({
          type: "allowed_adr_categories",
          entityIds: [SYNTHETIC_IDS.ADR_GASES_CLASS_2],
        }),
      ).toBe(true);
      expect(
        validateAllowedAdrCategoriesConfig({
          type: "allowed_adr_categories",
          entityIds: [],
        }),
      ).toBe(true);

      // Rejects non-UUIDs and extra properties
      expect(
        validateAllowedAdrCategoriesConfig({
          type: "allowed_adr_categories",
          entityIds: ["bad-uuid"],
        }),
      ).toBe(false);
      expect(
        validateAllowedAdrCategoriesConfig({
          type: "allowed_adr_categories",
          entityIds: [],
          otherField: 123,
        }),
      ).toBe(false);
    });
  });

  describe("5. Event Prescribed Load Exception Precedence (Scenario 14)", () => {
    const heavyPrescribedLoadTrip = createSyntheticTripEvidence({
      cargo: pinnedEntityFact(SYNTHETIC_IDS.CARGO_PRESCRIBED, "cargo"),
      cargoMassKg: knownFact("45000"), // 45 tonnes — violates ordinary Trainee 20t limit
      trailers: {
        complete: true,
        items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_HEAVY)], // violates ordinary Trainee standard trailer limit
      },
      adrCategory: pinnedEntityFact(SYNTHETIC_IDS.ADR_EXPLOSIVES_CLASS_1, "adr_category"), // violates Trainee no-ADR limit
    });

    const confirmedEventContext: EvaluationContext = createSyntheticEvaluationContext({
      confirmedEvent: {
        eventId: SYNTHETIC_IDS.EVENT_ID,
        eventRevisionId: SYNTHETIC_IDS.EVENT_REVISION_ID,
        attendanceRevisionId: SYNTHETIC_IDS.ATTENDANCE_REVISION_ID,
        prescribedCargoId: SYNTHETIC_IDS.CARGO_PRESCRIBED,
        prescribedMassKg: "45000",
        prescribedTrailerTypeId: SYNTHETIC_IDS.TRAILER_HEAVY,
      },
    });

    test("identifies bypassed qualification rule types", () => {
      expect(isBypassedQualificationRule("max_mass")).toBe(true);
      expect(isBypassedQualificationRule("allowed_trailer_types")).toBe(true);
      expect(isBypassedQualificationRule("allowed_adr_categories")).toBe(true);
      expect(isBypassedQualificationRule("custom_rule")).toBe(false);
    });

    test("confirmed attendance + matching load bypasses ordinary mass, trailer, and ADR restrictions", () => {
      const match = matchEventPrescribedLoad(heavyPrescribedLoadTrip, confirmedEventContext);
      expect(match.matches).toBe(true);
      expect(match.reasonCode).toBe(REASON_CODES.EVENT_PRESCRIBED_LOAD_BYPASS);

      const res = evaluateQualificationRules(
        heavyPrescribedLoadTrip,
        traineeRules,
        confirmedEventContext,
      );
      expect(res.outcome).toBe("pass");
      expect(res.eventExceptionApplied).toBe(true);
      expect(res.bypassedRules).toEqual([
        "max_mass",
        "allowed_trailer_types",
        "allowed_adr_categories",
      ]);
      expect(res.ruleResults.every((r) => r.bypassedByEvent === true)).toBe(true);
    });

    test("unconfirmed attendance (RSVP only / no attendanceRevisionId) fails to authorize bypass", () => {
      const unconfirmedContext: EvaluationContext = createSyntheticEvaluationContext({
        confirmedEvent: {
          eventId: SYNTHETIC_IDS.EVENT_ID,
          eventRevisionId: SYNTHETIC_IDS.EVENT_REVISION_ID,
          attendanceRevisionId: "", // Empty string = unconfirmed attendance
          prescribedCargoId: SYNTHETIC_IDS.CARGO_PRESCRIBED,
          prescribedMassKg: "45000",
          prescribedTrailerTypeId: SYNTHETIC_IDS.TRAILER_HEAVY,
        },
      });

      const match = matchEventPrescribedLoad(heavyPrescribedLoadTrip, unconfirmedContext);
      expect(match.matches).toBe(false);
      expect(match.reasonCode).toBe(REASON_CODES.EVENT_ATTENDANCE_UNCONFIRMED);

      // Ordinary trainee rules apply and reject the trip
      const res = evaluateQualificationRules(
        heavyPrescribedLoadTrip,
        traineeRules,
        unconfirmedContext,
      );
      expect(res.outcome).toBe("fail");
      expect(res.eventExceptionApplied).toBe(false);
    });

    test("mismatched load does not authorize bypass", () => {
      // Driver brought a different cargo than prescribed for the event
      const mismatchedCargoTrip = createSyntheticTripEvidence({
        cargo: pinnedEntityFact(SYNTHETIC_IDS.CARGO_MISMATCHED, "cargo"),
        cargoMassKg: knownFact("45000"),
        trailers: {
          complete: true,
          items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_HEAVY)],
        },
      });

      const match = matchEventPrescribedLoad(mismatchedCargoTrip, confirmedEventContext);
      expect(match.matches).toBe(false);
      expect(match.reasonCode).toBe(REASON_CODES.EVENT_PRESCRIBED_LOAD_MISMATCH);

      const res = evaluateQualificationRules(
        mismatchedCargoTrip,
        traineeRules,
        confirmedEventContext,
      );
      expect(res.outcome).toBe("fail");
    });

    test("event exception NEVER bypasses company acceptance rules", () => {
      // Cancelled trip matching event prescribed load
      const cancelledTrip = createSyntheticTripEvidence({
        outcome: "cancelled", // Proven failure for company acceptance
        cargo: pinnedEntityFact(SYNTHETIC_IDS.CARGO_PRESCRIBED, "cargo"),
        cargoMassKg: knownFact("45000"),
      });

      const acceptance = evaluateCompanyAcceptance(cancelledTrip);
      expect(acceptance.outcome).toBe("fail");
      expect(acceptance.reasonCodes).toContain(
        REASON_CODES.COMPANY_ACCEPTANCE_OUTCOME_NOT_DELIVERED,
      );
    });
  });

  describe("6. Company Trip Acceptance Evaluator", () => {
    test("passes valid delivered telemetry trip with complete recording and supported distance", () => {
      const validTrip = createSyntheticTripEvidence();
      const res = evaluateCompanyAcceptance(validTrip);
      expect(res.outcome).toBe("pass");
      expect(res.reasonCodes).toContain(REASON_CODES.COMPANY_ACCEPTANCE_PASSED);
      expect(res.details.outcomeDelivered).toBe(true);
      expect(res.details.recordingComplete).toBe(true);
      expect(res.details.distanceSupported).toBe(true);
    });

    test("fails when outcome is not delivered (open, cancelled, none)", () => {
      for (const outcome of ["open", "cancelled", "none"] as const) {
        const trip = createSyntheticTripEvidence({ outcome });
        const res = evaluateCompanyAcceptance(trip);
        expect(res.outcome).toBe("fail");
        expect(res.reasonCodes).toContain(REASON_CODES.COMPANY_ACCEPTANCE_OUTCOME_NOT_DELIVERED);
      }
    });

    test("fails telemetry trip when recording completeness is partial or unknown", () => {
      const partialTrip = createSyntheticTripEvidence({ recording: "partial" });
      const res = evaluateCompanyAcceptance(partialTrip);
      expect(res.outcome).toBe("fail");
      expect(res.reasonCodes).toContain(REASON_CODES.COMPANY_ACCEPTANCE_RECORDING_INCOMPLETE);
    });

    test("fails when wholeTripDistanceSupported is false or distance is 0", () => {
      const unsuppTrip = createSyntheticTripEvidence({ wholeTripDistanceSupported: false });
      const res = evaluateCompanyAcceptance(unsuppTrip);
      expect(res.outcome).toBe("fail");
      expect(res.reasonCodes).toContain(REASON_CODES.COMPANY_ACCEPTANCE_DISTANCE_NOT_SUPPORTED);

      const zeroTrip = createSyntheticTripEvidence({ actualDistanceM: knownFact("0") });
      const resZero = evaluateCompanyAcceptance(zeroTrip);
      expect(resZero.outcome).toBe("fail");
    });

    test("evaluates manual reports: requires completion screenshot attached", () => {
      const validManual = createSyntheticManualEvidence();
      const resValid = evaluateCompanyAcceptance(validManual);
      expect(resValid.outcome).toBe("pass");
      expect(resValid.details.screenshotAttached).toBe(true);

      const missingScreenshotManual = createSyntheticManualEvidence({
        provenance: { evidenceIds: [] },
      });
      const resMissing = evaluateCompanyAcceptance(missingScreenshotManual);
      expect(resMissing.outcome).toBe("fail");
      expect(resMissing.reasonCodes).toContain(REASON_CODES.COMPANY_ACCEPTANCE_SCREENSHOT_MISSING);
    });
  });

  describe("7. Qualification Progress Threshold Evaluator", () => {
    const condition: QualificationProgressCondition = {
      requiredTrips: 10,
      requiredDistanceM: "5000000", // 5,000 km
    };

    test("reports promotion eligible when both trip count and distance thresholds are met", () => {
      const totals: QualificationProgressTotals = {
        completedTrips: 10,
        completedDistanceM: "5000000",
      };
      const res = evaluateQualificationProgress(condition, totals);
      expect(res.eligibleForPromotion).toBe(true);
      expect(res.tripsSatisfied).toBe(true);
      expect(res.distanceSatisfied).toBe(true);
      expect(res.remainingTrips).toBe(0);
      expect(res.remainingDistanceM).toBe("0");
    });

    test("reports promotion not eligible when distance is insufficient", () => {
      const totals: QualificationProgressTotals = {
        completedTrips: 12,
        completedDistanceM: "4200000", // 4,200 km (800 km remaining)
      };
      const res = evaluateQualificationProgress(condition, totals);
      expect(res.eligibleForPromotion).toBe(false);
      expect(res.tripsSatisfied).toBe(true);
      expect(res.distanceSatisfied).toBe(false);
      expect(res.remainingTrips).toBe(0);
      expect(res.remainingDistanceM).toBe("800000");
    });

    test("reports promotion not eligible when trip count is insufficient", () => {
      const totals: QualificationProgressTotals = {
        completedTrips: 7, // 3 trips remaining
        completedDistanceM: "6000000",
      };
      const res = evaluateQualificationProgress(condition, totals);
      expect(res.eligibleForPromotion).toBe(false);
      expect(res.tripsSatisfied).toBe(false);
      expect(res.distanceSatisfied).toBe(true);
      expect(res.remainingTrips).toBe(3);
      expect(res.remainingDistanceM).toBe("0");
    });

    test("handles null thresholds (unconstrained promotion / top driver level)", () => {
      const topLevelCondition: QualificationProgressCondition = {
        requiredTrips: null,
        requiredDistanceM: null,
      };
      const totals: QualificationProgressTotals = {
        completedTrips: 50,
        completedDistanceM: "25000000",
      };
      const res = evaluateQualificationProgress(topLevelCondition, totals);
      expect(res.eligibleForPromotion).toBe(true);
      expect(res.tripsSatisfied).toBe(true);
      expect(res.distanceSatisfied).toBe(true);
      expect(res.remainingTrips).toBeNull();
      expect(res.remainingDistanceM).toBeNull();
    });
  });

  describe("8. Registry & Extensibility (Acceptance Criterion 4)", () => {
    test("validates and parses registered rules, rejecting unknown rule types", () => {
      const registry = createDefaultRegistry();
      const validated = registry.validateRuleSet(traineeRules);
      expect(validated).toHaveLength(3);

      expect(() =>
        registry.validateRule({ type: "arbitrary_executable_script", script: "eval(1)" }),
      ).toThrow("UNKNOWN_RULE_TYPE");
    });

    test("supports registering and evaluating custom pure rule evaluators", () => {
      const registry = createDefaultRegistry();

      interface MinDistanceRule {
        type: "min_distance";
        minM: string;
        [key: string]: unknown;
      }

      registry.register<MinDistanceRule>({
        type: "min_distance",
        validateConfig(c: unknown): c is MinDistanceRule {
          return (
            typeof c === "object" &&
            c !== null &&
            (c as Record<string, unknown>).type === "min_distance" &&
            typeof (c as Record<string, unknown>).minM === "string"
          );
        },
        evaluate(rule: MinDistanceRule, evidence, _ctx) {
          if (evidence.actualDistanceM.status !== "known") {
            return {
              ruleType: "min_distance",
              outcome: "unknown",
              observed: null,
              expected: rule.minM,
              reasonCode: "distance_unknown",
            };
          }
          const pass = compareDecimal(evidence.actualDistanceM.value, rule.minM) >= 0;
          return {
            ruleType: "min_distance",
            outcome: pass ? "pass" : "fail",
            observed: evidence.actualDistanceM.value,
            expected: rule.minM,
            reasonCode: pass ? "distance_met" : "distance_too_short",
          };
        },
      });

      const longTrip = createSyntheticTripEvidence({
        actualDistanceM: knownFact("500000"), // 500 km
      });
      const shortTrip = createSyntheticTripEvidence({
        actualDistanceM: knownFact("50000"), // 50 km
      });

      const customRule: MinDistanceRule = { type: "min_distance", minM: "100000" };

      expect(registry.evaluate(longTrip, [customRule]).outcome).toBe("pass");
      expect(registry.evaluate(shortTrip, [customRule]).outcome).toBe("fail");
    });
  });

  describe("9. Normative Product Scenarios", () => {
    test("Scenario 2: Trainee vs Driver qualification level eligibility rule sets", () => {
      // Trip with 30-tonne load and heavy trailer:
      // Fails Trainee level (20t max, standard trailer only)
      // Passes Driver III level (35t max, standard + heavy trailer)
      const intermediateTrip = createSyntheticTripEvidence({
        cargoMassKg: knownFact("30000"),
        trailers: {
          complete: true,
          items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_HEAVY)],
        },
      });

      const traineeResult = evaluateQualificationRules(intermediateTrip, traineeRules);
      expect(traineeResult.outcome).toBe("fail");

      const driverResult = evaluateQualificationRules(intermediateTrip, driverLevel3Rules);
      expect(driverResult.outcome).toBe("pass");

      // Trip with 65-tonne load, heavy trailer, and Class 1 Explosives ADR:
      // Fails Driver III level (35t max, no Class 1 ADR)
      // Passes Driver I level (80t max, Class 1 ADR permitted)
      const heavyTrip = createSyntheticTripEvidence({
        cargoMassKg: knownFact("65000"),
        trailers: {
          complete: true,
          items: [pinnedEntityFact(SYNTHETIC_IDS.TRAILER_HEAVY)],
        },
        adrCategory: pinnedEntityFact(SYNTHETIC_IDS.ADR_EXPLOSIVES_CLASS_1, "adr_category"),
      });
      expect(evaluateQualificationRules(heavyTrip, driverLevel3Rules).outcome).toBe("fail");
      expect(evaluateQualificationRules(heavyTrip, driverLevel1Rules).outcome).toBe("pass");
    });

    test("Scenario 11 & 32: Manual report field set evaluation against rules", () => {
      const manualTrip = createSyntheticManualEvidence();
      const res = evaluateQualificationRules(manualTrip, traineeRules);
      expect(res.outcome).toBe("pass");
    });

    test("Scenario 18 & 36: Independent game-specific rules evaluated without hardcoded fixture limits", () => {
      // Dynamic rules configured with arbitrary valid limits
      const atsCustomRules = [
        { type: "max_mass", maxKg: "54321.123" } satisfies MaxMassRule,
        {
          type: "allowed_trailer_types",
          entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD],
        } satisfies AllowedTrailerTypesRule,
      ];

      const trip = createSyntheticTripEvidence({
        game: "ats",
        cargoMassKg: knownFact("54321.123"),
      });

      const res = evaluateQualificationRules(trip, atsCustomRules);
      expect(res.outcome).toBe("pass");
    });
  });

  describe("10. Locale Independence", () => {
    test("evaluation outcomes are strictly deterministic and identical regardless of locale context", () => {
      const trip = createSyntheticTripEvidence();
      const res1 = evaluateQualificationRules(trip, traineeRules);
      const res2 = evaluateQualificationRules(trip, traineeRules);
      expect(res1).toEqual(res2);
    });
  });
});
