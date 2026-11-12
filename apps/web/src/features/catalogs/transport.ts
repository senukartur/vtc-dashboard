import { z } from "zod";
import {
  type CatalogDTO,
  depotListSchema,
  depotSchema,
  labelSchema,
} from "../../shared/catalog-selectors/contracts.js";

const text = z.string().min(1),
  count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// DLCs, companies and depots carry no translation, so they report no untranslated count.
const canonicalCounts = z.strictObject({ visible: count, hidden: count });
const listCounts = canonicalCounts.extend({ untranslated: count.exactOptional() });
export const summarySchema: z.ZodType<CatalogDTO["CatalogSummary"]> = z.strictObject({
  game: z.enum(["ets2", "ats"]),
  lists: z.strictObject({
    dlcs: canonicalCounts,
    regions: listCounts,
    cities: listCounts,
    companies: canonicalCounts.extend({ missingLogo: count.exactOptional() }),
    depots: canonicalCounts,
    cargoes: listCounts,
    trailers: listCounts,
  }),
});
const issue = z.strictObject({ field: text.max(64), reason: text.max(64) });
export const importPreviewSchema: z.ZodType<CatalogDTO["CatalogImportPreview"]> = z.strictObject({
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  token: text.max(2048).nullable(),
  rows: count,
  added: count,
  changed: count,
  unchanged: count,
  errors: count,
  lines: z.array(
    z.strictObject({
      line: count,
      code: z.string().max(128).nullable(),
      status: z.enum(["error", "changed"]),
      issues: z.array(issue),
      changedFields: z.array(text.max(64)),
    }),
  ),
  truncated: z.boolean(),
});
export const importResultSchema: z.ZodType<CatalogDTO["CatalogImportResult"]> = z.strictObject({
  importId: z.uuidv4(),
  rows: count,
  added: count,
  changed: count,
  unchanged: count,
});
export { depotListSchema, depotSchema, labelSchema };
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
