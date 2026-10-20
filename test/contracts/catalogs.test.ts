import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const id = "10000000-0000-4000-8000-000000000001",
  revisionId = "20000000-0000-4000-8000-000000000001";
const validate = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
test("catalog display fallback and pinned identities conform to existing browser DTOs", () => {
  const entity = {
    id,
    revisionId,
    game: "ats",
    kind: "city",
    mapNamespace: "base",
    display: {
      entityId: id,
      label: "Fictional City",
      requestedLocale: "ru",
      renderedLocale: "en",
      englishFallback: true,
      retired: true,
    },
    relatedEntityIds: [],
  };
  expect(validate("CatalogEntity")(entity)).toBe(true);
  expect(validate("CatalogEntity")({ ...entity, cargoMassKg: "1000" })).toBe(false);
  expect(validate("CatalogEntity")({ ...entity, sourcePath: "nonfunctional-placeholder" })).toBe(
    false,
  );
});
test("existing publication input separates pointer version from the candidate ETag and rejects invented review flags", () => {
  expect(
    validate("PublicationInput")({ expectedPublicationVersion: 1, reason: "Fictional review" }),
  ).toBe(true);
  expect(
    validate("PublicationInput")({ expectedPublicationVersion: 0, reason: "Fictional review" }),
  ).toBe(false);
  expect(
    validate("PublicationInput")({
      expectedPublicationVersion: 1,
      reason: "Fictional review",
      approved: true,
    }),
  ).toBe(false);
  expect(
    validate("Operation")({ id, state: "failed", resultId: null, failureCode: "invalid_artifact" }),
  ).toBe(true);
});
