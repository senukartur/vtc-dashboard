import { expect, test } from "vitest";
import {
  canPublish,
  changeCount,
  entityLabel,
  importSteps,
  labelChange,
  packProblems,
  publishBlockers,
  renderValue,
  revisionRows,
  stateTone,
} from "../../apps/web/src/features/catalogs/model.ts";
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

const candidate: CatalogDTO["CatalogRevision"] = {
  id,
  version: 3,
  publicationVersion: 7,
  game: "ats",
  state: "draft",
  coverageComplete: true,
  englishLabelsComplete: true,
  sourceReviewComplete: true,
  createdAt: "2026-10-20T00:00:00.000Z",
};
const manifest: CatalogDTO["CatalogReview"] = {
  revisionId: id,
  version: 3,
  comparisonRevisionId: revision,
  gameBuild: "Synthetic build",
  releaseInventoryAsOf: "2026-10-20",
  addedEntities: 2,
  changedEntities: 1,
  retiredEntities: 1,
  expectedPacks: 3,
  validatedPacks: 1,
  missingPacks: 1,
  failedPacks: 1,
  nonContributingPacks: 0,
  mappingIssues: 0,
  sourceReviewState: "approved",
  provenance: [],
};
// The gate before the compact rework, kept verbatim as the reference for publishBlockers.
const previousGate = (r: CatalogDTO["CatalogRevision"], m: CatalogDTO["CatalogReview"]) =>
  r.version === m.version &&
  r.state === "draft" &&
  r.coverageComplete &&
  r.englishLabelsComplete &&
  r.sourceReviewComplete &&
  m.mappingIssues === 0;

test("publication blockers match the previous gate and keep a fixed order", () => {
  for (const version of [3, 4])
    for (const state of ["draft", "validated", "published", "rejected"] as const)
      for (const coverageComplete of [true, false])
        for (const englishLabelsComplete of [true, false])
          for (const sourceReviewComplete of [true, false])
            for (const mappingIssues of [0, 2]) {
              const r = {
                ...candidate,
                version,
                state,
                coverageComplete,
                englishLabelsComplete,
                sourceReviewComplete,
              };
              const m = { ...manifest, mappingIssues };
              expect(canPublish(r, m)).toBe(previousGate(r, m));
              expect(publishBlockers(r, m).length === 0).toBe(previousGate(r, m));
            }
  expect(publishBlockers(undefined, manifest)).toEqual([{ kind: "unavailable" }]);
  expect(canPublish(candidate, undefined)).toBe(false);
  expect(
    publishBlockers(
      {
        ...candidate,
        version: 4,
        state: "published",
        coverageComplete: false,
        englishLabelsComplete: false,
        sourceReviewComplete: false,
      },
      { ...manifest, mappingIssues: 2, sourceReviewState: "pending" },
    ),
  ).toEqual([
    { kind: "version" },
    { kind: "state", state: "published" },
    { kind: "coverage", problems: 2 },
    { kind: "english" },
    { kind: "source", state: "pending" },
    { kind: "mappings", count: 2 },
  ]);
  expect(packProblems(manifest)).toBe(2);
  expect(changeCount(manifest)).toBe(4);
});

test("import progress derives from artifact and operation state only", () => {
  const states = (...args: Parameters<typeof importSteps>) =>
    importSteps(...args).map((step) => `${step.id}:${step.state}`);
  expect(states(undefined, undefined)).toEqual([
    "uploaded:pending",
    "imported:pending",
    "ready:pending",
  ]);
  expect(states("ready", undefined)).toEqual([
    "uploaded:done",
    "imported:current",
    "ready:pending",
  ]);
  expect(states("processing", undefined)).toEqual([
    "uploaded:current",
    "imported:pending",
    "ready:pending",
  ]);
  expect(states("rejected", "completed")).toEqual([
    "uploaded:failed",
    "imported:pending",
    "ready:pending",
  ]);
  expect(states(undefined, "processing")).toEqual([
    "uploaded:done",
    "imported:current",
    "ready:pending",
  ]);
  expect(states(undefined, "unknown")).toEqual([
    "uploaded:done",
    "imported:current",
    "ready:pending",
  ]);
  expect(states(undefined, "completed")).toEqual(["uploaded:done", "imported:done", "ready:done"]);
  expect(states(undefined, "failed")).toEqual([
    "uploaded:done",
    "imported:failed",
    "ready:pending",
  ]);
});

test("revision rows mark current and replaced and add only an unpublished same-game candidate", () => {
  const current = { ...candidate, id: revision, state: "published" as const },
    older = { ...current, id: "53000000-0000-4000-8000-000000000020" };
  const statuses = (rows: ReturnType<typeof revisionRows>) =>
    rows.map((row) => `${row.revision.id}:${row.status}`);
  expect(statuses(revisionRows([current, older], undefined, "ats"))).toEqual([
    `${revision}:current`,
    `${older.id}:replaced`,
  ]);
  expect(statuses(revisionRows([current, older], candidate, "ats"))).toEqual([
    `${id}:draft`,
    `${revision}:current`,
    `${older.id}:replaced`,
  ]);
  expect(statuses(revisionRows([current], { ...candidate, state: "rejected" }, "ats"))[0]).toBe(
    `${id}:rejected`,
  );
  expect(statuses(revisionRows([current], candidate, "ets2"))).toEqual([`${revision}:current`]);
  expect(statuses(revisionRows([current], { ...candidate, state: "published" }, "ats"))).toEqual([
    `${revision}:current`,
  ]);
  expect(statuses(revisionRows([{ ...candidate, state: "published" }], candidate, "ats"))).toEqual([
    `${id}:current`,
  ]);
  expect(revisionRows([], undefined, "ats")).toEqual([]);
});

test("review values and labels render returned facts without inventing data", () => {
  expect(renderValue(null)).toBe("∅");
  expect(renderValue(false)).toBe("false");
  expect(renderValue(1200)).toBe("1200");
  expect(renderValue(["a", "b"])).toBe("a · b");
  const english = { field: "label_en", before: "Fictional old city", after: "Fictional city" },
    russian = { field: "label_ru", before: null, after: null };
  const change: CatalogDTO["CatalogEntityChange"] = {
    entityId: id,
    kind: "city",
    changeKind: "changed",
    fields: [english, russian] as CatalogDTO["CatalogEntityChange"]["fields"],
    reasonCodes: [],
  };
  expect(entityLabel(change)).toBe("Fictional city");
  expect(entityLabel({ ...change, fields: [] })).toBeNull();
  expect(labelChange(change)).toEqual({
    en: { returned: true, value: "Fictional city" },
    ru: { returned: true, value: null },
  });
  expect(labelChange({ ...change, fields: change.fields.slice(0, 1) })?.ru).toEqual({
    returned: false,
  });
  expect(
    labelChange({ ...change, fields: [{ field: "retired", before: false, after: true }] }),
  ).toBeNull();
  expect(stateTone("current")).toEqual({ tone: "accepted", glyph: "✓" });
  expect(stateTone("rejected").tone).toBe("destructive");
});

test("catalog strings keep RU/EN parity, selector keys and the compact review vocabulary", () => {
  const { en, ru } = catalogTranslations;
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  for (const key of [
    "pageForbidden",
    "badgeInUse",
    "badgeNone",
    "revisionsTitle",
    "statusDraft",
    "progressLabel",
    "noCandidateTitle",
    "summaryLabel",
    "conditionsLabel",
    "sectionsLabel",
    "tabChanges",
    "changeType",
    "packFailed",
    "mappingTitle",
    "resolveOpen",
    "whyReady",
    "whyBlocked",
    "confirmPointer",
    "searchTitle",
  ])
    expect(en).toHaveProperty(key);
  for (const key of [
    "intro",
    "administration",
    "gates",
    "expectedPacks",
    "mappingIssues",
    "fields",
    "before",
    "after",
    "provider",
    "sourceId",
    "map",
    "provenance",
  ])
    expect(en).not.toHaveProperty(key);
  // The shared CatalogSelector, trips and qualifications read these keys.
  for (const key of [
    "search",
    "choose",
    "fallback",
    "retired",
    "selected",
    "historical",
    "historyError",
    "clear",
    "loading",
    "empty",
    "readError",
    "refresh",
    "more",
  ])
    expect(en).toHaveProperty(key);
  expect(en.packFailed).not.toBe(en.failed);
  expect(ru.packFailed).not.toBe(ru.failed);
  expect(en.reviewTitle).toBe("Candidate review");
  expect(en.publish).toBe("Review publication");
  for (const value of [...Object.values(en), ...Object.values(ru)]) {
    expect(value).not.toMatch(/Достаточно суров|Yukon\?|Юкон\?/);
    expect(value).not.toMatch(/справочник/i);
  }
});
