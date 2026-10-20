import { z } from "zod";
import { type CatalogDTO, pageSchema, uuid } from "../../shared/catalog-selectors/contracts.js";

const text = z.string().min(1),
  count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const provenance = z.strictObject({
  referenceId: uuid,
  publicSourceUrl: z.url(),
  attribution: text.max(2048),
  permittedUseBasis: text.max(2048),
  observedAt: z.iso.datetime({ precision: 3 }),
});
export const reviewSchema: z.ZodType<CatalogDTO["CatalogReview"]> = z.strictObject({
  revisionId: uuid,
  version: count.min(1),
  comparisonRevisionId: uuid.nullable(),
  gameBuild: text.max(128),
  releaseInventoryAsOf: z.iso.date(),
  addedEntities: count,
  changedEntities: count,
  retiredEntities: count,
  expectedPacks: count,
  validatedPacks: count,
  missingPacks: count,
  failedPacks: count,
  nonContributingPacks: count,
  mappingIssues: count,
  sourceReviewState: z.enum(["pending", "approved", "rejected"]),
  provenance: z.array(provenance),
});
const kind = z.enum([
  "city",
  "region",
  "cargo",
  "trailer_type",
  "trailer_body_type",
  "trailer_chain_type",
  "adr_category",
]);
const field = z.enum([
  "label_en",
  "label_ru",
  "region_id",
  "cargo_unit_mass_kg",
  "adr_category_id",
  "trailer_body_type_id",
  "trailer_chain_type_id",
  "retired",
  "source_mapping",
]);
const value = z.union([text.max(2048), z.boolean(), count, z.array(text.max(256))]).nullable();
export const changesSchema = pageSchema(
  z.strictObject({
    entityId: uuid,
    kind,
    changeKind: z.enum(["added", "changed", "retired"]),
    fields: z.array(z.strictObject({ field, before: value, after: value })),
    reasonCodes: z.array(text.max(128)),
  }),
);
export const coverageSchema = pageSchema(
  z.strictObject({
    packId: text.max(128),
    title: text.max(256),
    state: z.enum(["validated", "missing", "failed", "non_contributing"]),
    contributionKinds: z.array(kind),
    provenance: z.array(provenance),
    reasonCodes: z.array(text.max(128)),
  }),
);
export const issuesSchema = pageSchema(
  z.strictObject({
    id: uuid,
    provider: text.max(128),
    mapNamespace: text.max(128).nullable(),
    sourceId: text.max(128).nullable(),
    sourceLocale: text.max(32).nullable(),
    reasonCode: text.max(128),
    candidateEntityIds: z.array(uuid),
  }),
);
export const artifactSchema: z.ZodType<CatalogDTO["CatalogArtifact"]> = z.strictObject({
  id: uuid,
  state: z.enum(["processing", "ready", "rejected"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: count,
});
export const operationSchema: z.ZodType<CatalogDTO["Operation"]> = z.strictObject({
  id: uuid,
  state: z.enum(["processing", "completed", "failed"]),
  resultId: uuid.nullable(),
  failureCode: text.max(128).nullable(),
});
export const policySchema: z.ZodType<CatalogDTO["UploadPolicy"]> = z.strictObject({
  enabled: z.boolean(),
  maxFileBytes: count.min(1).nullable(),
  maxFilesPerReport: count.min(1).nullable(),
  allowedMimeTypes: z.array(text.max(128)),
  policyRevision: count.min(1),
});
export const commandResultSchema = z.strictObject({ id: uuid, version: count.min(1) });
export type CatalogAttempt = { fingerprint: string; key: string; createdAt: number };
export function catalogAttempt(
  fingerprint: string,
  previous: CatalogAttempt | null,
  now = Date.now(),
): CatalogAttempt {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID(), createdAt: now };
}
