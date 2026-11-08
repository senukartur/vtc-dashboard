import type { components } from "@vtc/contracts";
import { z } from "zod";

export type CatalogDTO = components["schemas"];
export type CatalogItem = CatalogDTO["CatalogItem"];
export type Game = CatalogItem["game"];
export type Kind = "city" | "cargo" | "trailer";
export type CatalogList = "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
export const adrClasses = ["1", "2", "3", "4", "6", "8"] as const;
export type AdrClass = (typeof adrClasses)[number];
export const listOfKind: Record<Kind, CatalogList> = {
  city: "cities",
  cargo: "cargoes",
  trailer: "trailers",
};
export const uuid = z.uuidv4();
const text = z.string().min(1);
const game = z.enum(["ets2", "ats"]);
const locale = z.enum(["en", "ru"]);
export const labelSchema: z.ZodType<CatalogDTO["CatalogLabel"]> = z.strictObject({
  entityId: uuid,
  label: text.max(256),
  requestedLocale: locale,
  renderedLocale: locale,
  englishFallback: z.boolean(),
  hidden: z.boolean(),
});
export const itemSchema = z.strictObject({
  id: uuid,
  game,
  code: text.max(128),
  nameEn: text.max(256),
  nameRu: z.string().max(256).nullable(),
  hidden: z.boolean(),
  display: labelSchema,
  dlcId: uuid.nullable(),
  dlc: labelSchema.nullable(),
  steamAppId: z.number().int().positive().nullable().optional(),
  regionId: uuid.nullable().optional(),
  region: labelSchema.nullable().optional(),
  adrClass: z.enum(adrClasses).nullable().optional(),
}) as unknown as z.ZodType<CatalogItem>;
export const envelope = <T extends z.ZodType>(
  data: T,
): z.ZodType<{ data: z.output<T>; meta: { requestId: string } }> =>
  z.strictObject({
    data,
    meta: z.strictObject({ requestId: text.max(128) }),
  }) as unknown as z.ZodType<{ data: z.output<T>; meta: { requestId: string } }>;
export const listSchema = z.strictObject({
  items: z.array(itemSchema).max(100),
  nextCursor: text.max(2048).nullable(),
  total: z.number().int().min(0),
});
export function catalogParams(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  return params.toString();
}
/** Can this row be newly chosen? Hidden rows stay readable but leave the selector. */
export function compatibleSelection(item: CatalogItem, game: Game, regionId?: string) {
  return item.game === game && !item.hidden && (!regionId || item.regionId === regionId);
}
