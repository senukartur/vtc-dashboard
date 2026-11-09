import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const id = "10000000-0000-4000-8000-000000000001",
  regionId = "20000000-0000-4000-8000-000000000001";
const validate = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const label = {
  entityId: id,
  label: "Fictional City",
  requestedLocale: "ru",
  renderedLocale: "en",
  englishFallback: true,
  hidden: false,
};
const item = {
  id,
  game: "ats",
  code: "_fixture__city",
  nameEn: "Fictional City",
  nameRu: null,
  hidden: false,
  display: label,
  dlcId: null,
  dlc: null,
  regionId,
  region: { ...label, entityId: regionId, label: "Fictional Region" },
};

test("catalog items carry label fallback and reject the retired revision model", () => {
  expect(validate("CatalogItem")(item)).toBe(true);
  expect(validate("CatalogItem")({ ...item, adrClass: "3" })).toBe(true);
  expect(validate("CatalogItem")({ ...item, adrClass: "5" })).toBe(false);
  for (const extra of [
    { revisionId: id },
    { mapNamespace: "base" },
    { cargoMassKg: "1000" },
    { sourcePath: "nonfunctional-placeholder" },
  ])
    expect(validate("CatalogItem")({ ...item, ...extra })).toBe(false);
  expect(validate("CatalogItem")({ ...item, display: { ...label, retired: true } })).toBe(false);
  expect(validate("CatalogLabel")({ ...label, hidden: undefined })).toBe(false);
  expect(validate("EffectiveCatalogPin")({ entityId: id })).toBe(true);
  expect(validate("EffectiveCatalogPin")({ entityId: id, catalogRevisionId: id })).toBe(false);
});

test("the canonical city name is optional on labels and items and rejects a blank value", () => {
  const validLabel = validate("CatalogLabel"),
    validItem = validate("CatalogItem");
  expect(validLabel({ ...label, nameNative: "Krönburg" })).toBe(true);
  expect(validLabel(label)).toBe(true);
  expect(validLabel({ ...label, nameNative: "" })).toBe(false);
  expect(validLabel({ ...label, nameNative: "x".repeat(257) })).toBe(false);
  expect(validLabel({ ...label, nameNative: null })).toBe(false);
  expect(validItem({ ...item, nameNative: "Krönburg" })).toBe(true);
  expect(validItem({ ...item, nameNative: null })).toBe(true);
  expect(validItem(item)).toBe(true);
  expect(validItem({ ...item, nameNative: "" })).toBe(false);
  expect(validItem({ ...item, nameNative: "x".repeat(257) })).toBe(false);
  expect(validItem({ ...item, display: { ...label, nameNative: "" } })).toBe(false);
});

test("the canonical name is a nullable write field for cities only", () => {
  const base = { game: "ets2", code: "kronburg", nameEn: "Crownburg" };
  expect(validate("CatalogCityInput")({ ...base, nameNative: "Krönburg" })).toBe(true);
  expect(validate("CatalogCityInput")({ ...base, nameNative: null })).toBe(true);
  expect(validate("CatalogCityInput")({ ...base, nameNative: "x".repeat(257) })).toBe(false);
  expect(validate("CatalogCargoInput")({ ...base, nameNative: "Krönburg" })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, nameNative: "Krönburg" })).toBe(false);
  expect(validate("CatalogItemPatch")({ nameNative: null })).toBe(true);
  expect(validate("CatalogItemPatch")({ nameNative: "Krönburg" })).toBe(true);
});

test("create inputs follow each list and treat code as bounded opaque text", () => {
  const base = { game: "ets2", code: "_x__x", nameEn: "Fictional" };
  expect(validate("CatalogDlcInput")({ ...base, steamAppId: 4294967295 })).toBe(true);
  expect(validate("CatalogDlcInput")({ ...base, steamAppId: 0 })).toBe(false);
  expect(validate("CatalogCityInput")({ ...base, regionId })).toBe(true);
  expect(validate("CatalogCargoInput")({ ...base, adrClass: "8" })).toBe(true);
  expect(validate("CatalogCargoInput")({ ...base, adrClass: "7" })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, dlcId: id })).toBe(true);
  expect(validate("CatalogTrailerInput")({ ...base, adrClass: "8" })).toBe(false);
  for (const code of ["", "a b", "a\u0000", " a", "a".repeat(129)])
    expect(validate("CatalogTrailerInput")({ ...base, code })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, nameEn: "   " })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, game: "eu" })).toBe(false);
});

test("a row edit is partial, non-empty and can never move a row between games", () => {
  expect(validate("CatalogItemPatch")({ hidden: true })).toBe(true);
  expect(validate("CatalogItemPatch")({ nameRu: null, code: "renamed" })).toBe(true);
  expect(validate("CatalogItemPatch")({})).toBe(false);
  expect(validate("CatalogItemPatch")({ game: "ats" })).toBe(false);
  expect(validate("CatalogItemPatch")({ hidden: "yes" })).toBe(false);
});

test("import results are closed and a preview with errors withholds its token", () => {
  const preview = {
    fileSha256: "a".repeat(64),
    token: null,
    rows: 2,
    added: 1,
    changed: 0,
    unchanged: 0,
    errors: 1,
    lines: [
      {
        line: 3,
        code: null,
        status: "error",
        issues: [{ field: "code", reason: "invalid" }],
        changedFields: [],
      },
    ],
    truncated: false,
  };
  expect(validate("CatalogImportPreview")(preview)).toBe(true);
  expect(validate("CatalogImportPreview")({ ...preview, token: "t".repeat(2049) })).toBe(false);
  expect(
    validate("CatalogImportPreview")({
      ...preview,
      lines: [{ ...preview.lines[0], status: "added" }],
    }),
  ).toBe(false);
  expect(
    validate("CatalogImportResult")({ importId: id, rows: 1, added: 1, changed: 0, unchanged: 0 }),
  ).toBe(true);
  expect(validate("CatalogImportResult")({ importId: id, rows: 1, added: 1, changed: 0 })).toBe(
    false,
  );
});
