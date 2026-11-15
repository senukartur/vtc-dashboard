import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
  );
const spec = read("openapi.json");
const cases = read("examples.json").cases as {
  id: string;
  request?: Record<string, unknown>;
  response: { data: Record<string, unknown> };
}[];
const fixture = (id: string) => {
  const found = cases.find((item) => item.id === id);
  if (!found) throw new Error(`MISSING_FIXTURE ${id}`);
  return structuredClone(found);
};
const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });

test("the referral answer is optional and its free text is bounded", () => {
  const input = valid("ApplicationInput");
  const submitted = fixture("submitApplication:stage-4-referral-other").request ?? {};
  expect(input(submitted)).toBe(true);
  const { referralSource: _source, referralOther: _other, ...legacy } = submitted;
  expect(input(legacy)).toBe(true);
  for (const referralSource of [
    "truckersmp",
    "discord",
    "friend_or_member",
    "youtube_or_twitch",
    "other",
  ])
    expect(input({ ...legacy, referralSource }), referralSource).toBe(true);
  for (const mutation of [
    { referralSource: "newsletter" },
    { referralSource: null },
    { referralOther: "x".repeat(201) },
    { referralOther: "" },
    { referralOther: " \t " },
  ])
    expect(input({ ...submitted, ...mutation }), JSON.stringify(mutation)).toBe(false);
  // The web's zod reader cannot convert dependentRequired, so the source dependency is not in the
  // schema; the service rejects free text without the other source with 422.
  expect(input({ ...legacy, referralOther: "Text without a source" })).toBe(true);
  expect(input({ ...submitted, referralOther: "x".repeat(200) })).toBe(true);
});

test("the TruckersMP check keeps states, absence and failure distinct and carries no provider payload", () => {
  const application = valid("Application");
  const check = valid("ApplicationStage4TruckersmpCheck");
  const states = new Set<unknown>();
  for (const id of [
    "getApplication:stage-4-check-completed",
    "getApplication:stage-4-check-vanity",
    "getApplication:stage-4-check-checking",
    "getApplication:stage-4-check-failed",
    "getApplication:stage-4-not-found-no-vtc",
  ]) {
    const data = fixture(id).response.data;
    expect(application(data), id).toBe(true);
    const current = data.truckersmpCheck as Record<string, unknown>;
    expect(check(current), id).toBe(true);
    states.add(current.state);
  }
  expect([...states].sort()).toEqual(["checking", "completed", "failed", "not_checked"]);
  const completed = fixture("getApplication:stage-4-check-completed").response.data;
  const current = completed.truckersmpCheck as Record<string, unknown>;
  const { truckersmpCheck: _check, ...legacy } = completed;
  expect(application(legacy)).toBe(true);
  for (const mutation of [
    { state: "pending" },
    { notCheckedReason: "private_profile" },
    { failure: "http_500" },
    { profileUrl: "https://truckersmp.com/user/0" },
    { profileUrl: "https://example.invalid/user/900000000000001" },
    { bans: { any: true, count: -1 } },
    { bans: { any: true, count: 1, reasons: ["Fictional reason"] } },
    { vtc: { inVtc: true, id: "900000000001", name: "Fictional", tag: "F", memberId: "1" } },
    { rawResponse: { response: {} } },
    { providerPayload: "{}" },
    { steamId: "76561190000000001" },
    { leaseId: "41500000-0000-4000-8000-000000000001" },
  ])
    expect(check({ ...current, ...mutation }), JSON.stringify(mutation)).toBe(false);
  expect(check({ ...current, playerId: undefined })).toBe(false);
});

test("recheck is a bodyless idempotent staff command without If-Match and an unmounted stage", () => {
  const path = spec.paths["/api/v1/admin/applications/{applicationId}/truckersmp-checks"];
  expect(Object.keys(path)).toEqual(["post"]);
  const command = path.post;
  expect(command.operationId).toBe("recheckApplicationTruckersmp");
  expect(command["x-contract-stage"]).toBe("VTC-150 Step 1");
  expect(command["x-capability"]).toBe("applications.manage");
  expect(command.security).toEqual([{ sessionCookie: [], csrfHeader: [] }]);
  expect(command.requestBody).toBeUndefined();
  expect(Object.keys(command.responses).sort()).toEqual(["202", "default"]);
  expect(command.responses["202"].headers["Cache-Control"].schema).toEqual({ const: "no-store" });
  const references = command.parameters.map(
    (parameter: { $ref?: string; name?: string }) => parameter.$ref ?? parameter.name,
  );
  expect(references).toEqual(["applicationId", "#/components/parameters/IdempotencyKey"]);
  expect(
    valid("ApplicationStage4TruckersmpCheckEnvelope")(
      fixture("recheckApplicationTruckersmp:stage-4-accepted").response,
    ),
  ).toBe(true);
  for (const id of ["submitApplication", "getApplication"]) {
    const [operation] = Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods as Record<string, { operationId: string }>).filter(
        (item) => item.operationId === id,
      ),
    ) as { "x-stage-4-changes"?: { "x-owner-card": string } }[];
    expect(operation?.["x-stage-4-changes"]?.["x-owner-card"], id).toBe("VTC-144");
  }
});
