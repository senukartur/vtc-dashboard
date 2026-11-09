import { z } from "zod";
import { type CatalogDTO, labelSchema } from "../../shared/catalog-selectors/contracts.js";

const text = z.string().min(1),
  count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const summarySchema: z.ZodType<CatalogDTO["CatalogSummary"]> = z.strictObject({
  game: z.enum(["ets2", "ats"]),
  lists: z.strictObject({
    dlcs: z.strictObject({ visible: count, hidden: count }),
    regions: z.strictObject({ visible: count, hidden: count }),
    cities: z.strictObject({ visible: count, hidden: count }),
    cargoes: z.strictObject({ visible: count, hidden: count }),
    trailers: z.strictObject({ visible: count, hidden: count }),
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
export { labelSchema };
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
