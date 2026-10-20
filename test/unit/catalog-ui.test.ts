import { expect, test } from "vitest";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import { catalogAttempt, changesSchema } from "../../apps/web/src/features/catalogs/transport.ts";
import {
  type CatalogDTO,
  catalogParams,
  compatibleSelection,
  entitySchema,
} from "../../apps/web/src/shared/catalog-selectors/contracts.ts";

const id = "51000000-0000-4000-8000-000000000020",
  revision = "52000000-0000-4000-8000-000000000020";
const entity: CatalogDTO["CatalogEntity"] = {
  id,
  revisionId: revision,
  game: "ats",
  kind: "city",
  mapNamespace: "base",
  display: {
    entityId: id,
    label: "Fictional city",
    requestedLocale: "ru",
    renderedLocale: "en",
    englishFallback: true,
    retired: false,
  },
  relatedEntityIds: [id],
};
test("locale labels never change selection compatibility; retired and mismatched context cannot submit", () => {
  expect(entitySchema.parse(entity).id).toBe(id);
  expect(compatibleSelection(entity, "ats", revision, "city", id)).toBe(true);
  expect(
    compatibleSelection(
      { ...entity, display: { ...entity.display, retired: true } },
      "ats",
      revision,
      "city",
    ),
  ).toBe(false);
  expect(compatibleSelection(entity, "ets2", revision, "city")).toBe(false);
  expect(compatibleSelection(entity, "ats", id, "city")).toBe(false);
  expect(compatibleSelection(entity, "ats", revision, "cargo")).toBe(false);
  expect(compatibleSelection(entity, "ats", revision, "city", revision)).toBe(false);
});
test("uncertain retries retain their logical command key after more than sixty seconds", () => {
  const first = catalogAttempt("same-payload-and-etag", null, 100);
  expect(catalogAttempt("same-payload-and-etag", first, 100000)).toBe(first);
  expect(catalogAttempt("changed-etag", first, 100000).key).not.toBe(first.key);
  expect(catalogAttempt("same-payload-and-etag", null, 100000).key).not.toBe(first.key);
});
test("catalog filters encode exact IDs and safe search; review rejects unknown fields", () => {
  const query = new URLSearchParams(catalogParams({ regionId: id, search: "A & Б", cursor: null }));
  expect(query.get("regionId")).toBe(id);
  expect(query.get("search")).toBe("A & Б");
  expect(query.has("cursor")).toBe(false);
  expect(
    changesSchema.safeParse({
      items: [
        {
          entityId: id,
          kind: "city",
          changeKind: "changed",
          fields: [{ field: "private_payload", before: null, after: "sentinel" }],
          reasonCodes: [],
        },
      ],
      nextCursor: null,
    }).success,
  ).toBe(false);
  expect(Object.keys(catalogTranslations.ru).sort()).toEqual(
    Object.keys(catalogTranslations.en).sort(),
  );
});
