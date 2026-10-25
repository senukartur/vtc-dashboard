import type { components } from "@vtc/contracts";
import { expect, test, vi } from "vitest";
import {
  previewRules,
  validateDraftRules,
} from "../../apps/api/src/modules/qualifications/preview.ts";
import {
  attemptFor,
  countInput,
  exactInput,
  qualificationRead,
  schema,
  utcInput,
} from "../../apps/web/src/features/qualifications/transport.ts";

type S = components["schemas"];
const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const input = (mass: string | null = "10"): S["QualificationPreviewInput"] => ({
  game: "ets2",
  rules: [
    { type: "max_mass", maxKg: "10" },
    { type: "allowed_trailer_types", entityIds: [id] },
    { type: "allowed_adr_categories", entityIds: [id] },
  ],
  sample: {
    cargoMassKg: mass,
    trailerTypeIds: [id],
    trailersComplete: true,
    adr: { status: "known", entityId: id },
  },
});
test("hypothetical preview preserves exact equality, missing facts and failure precedence without mutable evidence", () => {
  expect(previewRules(input()).outcome).toBe("pass");
  expect(previewRules(input("10.000000000000000001")).outcome).toBe("fail");
  const missing = input(null);
  missing.sample.trailersComplete = false;
  expect(previewRules(missing)).toMatchObject({
    outcome: "unknown",
    ruleResults: [
      { reasonCode: "rule_mass_unknown" },
      { reasonCode: "rule_trailers_incomplete" },
      { reasonCode: "rule_passed" },
    ],
  });
  missing.sample.trailerTypeIds = [other];
  expect(previewRules(missing).outcome).toBe("fail");
  const nonhazardous = input();
  nonhazardous.sample.adr = { status: "non_hazardous", entityId: null };
  nonhazardous.rules = [{ type: "allowed_adr_categories", entityIds: [] }];
  expect(previewRules(nonhazardous).outcome).toBe("pass");
  nonhazardous.sample.adr = { status: "unknown", entityId: null };
  expect(previewRules(nonhazardous).outcome).toBe("unknown");
  const original = input(),
    before = structuredClone(original);
  previewRules(original);
  expect(original).toEqual(before);
  expect(Object.keys(previewRules(original).ruleResults[0] ?? {}).sort()).toEqual([
    "outcome",
    "reasonCode",
    "ruleType",
  ]);
});
test("publication and preview share lossless bounds and unique supported conditions", () => {
  for (const rules of [
    [{ type: "max_mass", maxKg: "100000000000000000000" }],
    [{ type: "max_mass", maxKg: "0.0000000000000000001" }],
    [
      { type: "max_mass", maxKg: "10" },
      { type: "max_mass", maxKg: "20" },
    ],
    [{ type: "allowed_trailer_types", entityIds: [id, id] }],
  ])
    expect(() => validateDraftRules(rules as S["Rule"][])).toThrow();
  expect(() =>
    validateDraftRules([{ type: "max_mass", maxKg: "99999999999999999999.999999999999999999" }]),
  ).not.toThrow();
  const bad = input();
  bad.sample.adr = { status: "known", entityId: null };
  expect(() => previewRules(bad)).toThrow();
});
test("form values retain exact precision and distinguish unset from zero; UTC fields ignore browser timezone", () => {
  expect(exactInput("0,1000")).toBe("0.1");
  expect(exactInput("99999999999999999999.999999999999999999")).toBe(
    "99999999999999999999.999999999999999999",
  );
  for (const s of ["1e3", "-1", "100000000000000000000", "0.0000000000000000001", ""])
    expect(exactInput(s)).toBeUndefined();
  expect(countInput("")).toBeNull();
  expect(countInput("0")).toBe(0);
  expect(countInput("2147483647")).toBe(2147483647);
  expect(countInput("2147483648")).toBeUndefined();
  expect(utcInput("2026-10-25T12:34:56.789")).toBe("2026-10-25T12:34:56.789Z");
  expect(utcInput("2026-02-31T12:00")).toBeUndefined();
  expect(utcInput("2026-02-29T12:00")).toBeUndefined();
  expect(utcInput("2028-02-29T12:00")).toBe("2028-02-29T12:00:00.000Z");
});
test("browser generated schemas consume qualification success and reject diagnostic additions", () => {
  const result = { data: previewRules(input()), meta: { requestId: "synthetic-preview" } };
  expect(schema("EnvelopeQualificationPreview").safeParse(result).success).toBe(true);
  expect(
    schema("EnvelopeQualificationPreview").safeParse({
      ...result,
      data: { ...result.data, ownerId: id },
    }).success,
  ).toBe(false);
});
test("uncertain command recovery retains original key and If-Match across refreshed versions", () => {
  for (const path of [
    "/admin/qualification-levels/example/rule-versions",
    "/admin/members/example/qualification-assignments",
  ]) {
    const intent = JSON.stringify(["POST", path, { reason: "Fictional unchanged intent" }]),
      first = attemptFor(intent, '"v1"', null),
      retry = attemptFor(intent, '"v2"', first);
    expect(retry).toBe(first);
    expect(retry.etag).toBe('"v1"');
    const changed = attemptFor(`${intent}changed`, '"v2"', first);
    expect(changed.key).not.toBe(first.key);
    expect(changed.etag).toBe('"v2"');
  }
});
test("only a validated SETUP_REQUIRED response identifies missing assignment, never generic conflict or disabled API", async () => {
  const packet = (code: string) => ({
    error: { code, messageKey: "synthetic_error", retryable: false },
    meta: { requestId: "synthetic-qualification-setup" },
  });
  vi.stubGlobal("fetch", async () => Response.json(packet("SETUP_REQUIRED"), { status: 409 }));
  await expect(
    qualificationRead(
      "/me/qualification-progress?game=ets2",
      "EnvelopeProgress",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ setupRequired: true, status: 409 });
  vi.stubGlobal("fetch", async () => Response.json(packet("VERSION_CONFLICT"), { status: 409 }));
  await expect(
    qualificationRead(
      "/me/qualification-progress?game=ets2",
      "EnvelopeProgress",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ setupRequired: false, status: 409 });
  vi.stubGlobal("fetch", async () => Response.json(packet("NOT_FOUND"), { status: 404 }));
  await expect(
    qualificationRead(
      "/me/qualification-progress?game=ets2",
      "EnvelopeProgress",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ setupRequired: false, status: 404 });
});
