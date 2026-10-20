import type { components } from "@vtc/contracts";
import { z } from "zod";

export type CatalogDTO = components["schemas"];
export type Game = CatalogDTO["CatalogRevision"]["game"];
export type Kind = CatalogDTO["CatalogEntity"]["kind"];
export type Selection = { entityId: string; revisionId: string };
export const kinds = [
  "city",
  "region",
  "cargo",
  "trailer_type",
  "trailer_body_type",
  "trailer_chain_type",
  "adr_category",
] as const;
export const uuid = z.uuidv4();
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const game = z.enum(["ets2", "ats"]);
const locale = z.enum(["en", "ru"]);
export const entitySchema: z.ZodType<CatalogDTO["CatalogEntity"]> = z.strictObject({
  id: uuid,
  revisionId: uuid,
  game,
  kind: z.enum(kinds),
  mapNamespace: text.max(128),
  display: z.strictObject({
    entityId: uuid,
    label: text.max(256),
    requestedLocale: locale,
    renderedLocale: locale,
    englishFallback: z.boolean(),
    retired: z.boolean(),
  }),
  relatedEntityIds: z.array(uuid),
});
export const revisionSchema: z.ZodType<CatalogDTO["CatalogRevision"]> = z.strictObject({
  id: uuid,
  version,
  publicationVersion: version,
  game,
  state: z.enum(["draft", "validated", "published", "rejected"]),
  coverageComplete: z.boolean(),
  englishLabelsComplete: z.boolean(),
  sourceReviewComplete: z.boolean(),
  createdAt: z.iso.datetime({ precision: 3 }),
});
export const envelope = <T extends z.ZodType>(
  data: T,
): z.ZodType<{ data: z.output<T>; meta: { requestId: string } }> =>
  z.strictObject({
    data,
    meta: z.strictObject({ requestId: text.max(128) }),
  }) as unknown as z.ZodType<{ data: z.output<T>; meta: { requestId: string } }>;
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: text.max(2048).nullable(),
  });
export const revisionsSchema = pageSchema(revisionSchema);
export const entitiesSchema = pageSchema(entitySchema);
export function catalogParams(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  return params.toString();
}
export function compatibleSelection(
  entity: CatalogDTO["CatalogEntity"],
  game: Game,
  revisionId: string,
  kind: Kind,
  regionId?: string,
) {
  return (
    entity.game === game &&
    entity.revisionId === revisionId &&
    entity.kind === kind &&
    !entity.display.retired &&
    (!regionId || entity.relatedEntityIds.includes(regionId))
  );
}
