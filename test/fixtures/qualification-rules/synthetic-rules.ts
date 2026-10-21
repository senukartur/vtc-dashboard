import type {
  AllowedAdrCategoriesRule,
  AllowedTrailerTypesRule,
  MaxMassRule,
  Rule,
} from "../../../apps/api/src/modules/qualification-rules/contracts.js";

// Canonical synthetic UUIDs strictly conforming to UUID v4
export const SYNTHETIC_IDS = {
  TRAILER_STANDARD: "00000000-0000-4000-8000-000000000001",
  TRAILER_HEAVY: "00000000-0000-4000-8000-000000000002",
  TRAILER_DISALLOWED: "00000000-0000-4000-8000-000000000099",

  ADR_EXPLOSIVES_CLASS_1: "00000000-0000-4000-8000-000000000101",
  ADR_GASES_CLASS_2: "00000000-0000-4000-8000-000000000102",
  ADR_FLAMMABLE_CLASS_3: "00000000-0000-4000-8000-000000000103",
  ADR_DISALLOWED_RADIOACTIVE: "00000000-0000-4000-8000-000000000199",

  CARGO_STANDARD: "00000000-0000-4000-8000-000000000201",
  CARGO_PRESCRIBED: "00000000-0000-4000-8000-000000000202",
  CARGO_MISMATCHED: "00000000-0000-4000-8000-000000000299",

  EVENT_ID: "00000000-0000-4000-8000-000000000301",
  EVENT_REVISION_ID: "00000000-0000-4000-8000-000000000302",
  ATTENDANCE_REVISION_ID: "00000000-0000-4000-8000-000000000303",

  RULE_VERSION_ID: "00000000-0000-4000-8000-000000000401",
  ASSIGNMENT_ID: "00000000-0000-4000-8000-000000000402",
} as const;

export const traineeRules: readonly Rule[] = [
  {
    type: "max_mass",
    maxKg: "20000",
  } satisfies MaxMassRule,
  {
    type: "allowed_trailer_types",
    entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD],
  } satisfies AllowedTrailerTypesRule,
  {
    type: "allowed_adr_categories",
    entityIds: [], // Trainee is not certified for any hazardous cargo
  } satisfies AllowedAdrCategoriesRule,
];

export const driverLevel3Rules: readonly Rule[] = [
  {
    type: "max_mass",
    maxKg: "35000",
  } satisfies MaxMassRule,
  {
    type: "allowed_trailer_types",
    entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD, SYNTHETIC_IDS.TRAILER_HEAVY],
  } satisfies AllowedTrailerTypesRule,
  {
    type: "allowed_adr_categories",
    entityIds: [SYNTHETIC_IDS.ADR_GASES_CLASS_2, SYNTHETIC_IDS.ADR_FLAMMABLE_CLASS_3],
  } satisfies AllowedAdrCategoriesRule,
];

export const driverLevel1Rules: readonly Rule[] = [
  {
    type: "max_mass",
    maxKg: "80000",
  } satisfies MaxMassRule,
  {
    type: "allowed_trailer_types",
    entityIds: [SYNTHETIC_IDS.TRAILER_STANDARD, SYNTHETIC_IDS.TRAILER_HEAVY],
  } satisfies AllowedTrailerTypesRule,
  {
    type: "allowed_adr_categories",
    entityIds: [
      SYNTHETIC_IDS.ADR_EXPLOSIVES_CLASS_1,
      SYNTHETIC_IDS.ADR_GASES_CLASS_2,
      SYNTHETIC_IDS.ADR_FLAMMABLE_CLASS_3,
    ],
  } satisfies AllowedAdrCategoriesRule,
];
