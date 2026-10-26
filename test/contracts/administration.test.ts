import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
test("leadership confirmation cannot supply a successor and safe audit rejects private payload", () => {
  const id = "03800000-0000-4000-8000-000000000001";
  expect(valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL" })).toBe(true);
  expect(
    valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL", successorId: id }),
  ).toBe(false);
  const audit = {
    id,
    actorId: null,
    action: "configuration.changed",
    subjectId: id,
    occurredAt: "2026-10-26T12:00:00.000Z",
  };
  expect(valid("AuditEntry")(audit)).toBe(true);
  for (const field of ["reason", "email", "token", "payload", "link"])
    expect(valid("AuditEntry")({ ...audit, [field]: "PRIVATE_PLACEHOLDER" })).toBe(false);
  expect(valid("ReinstateInput")({ roles: ["driver"], assignments: [], reason: "Fictional" })).toBe(
    false,
  );
});
