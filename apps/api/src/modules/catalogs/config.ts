import { adrClasses } from "@vtc/db/catalogs-schema";

export const catalogLists = ["dlcs", "regions", "cities", "cargoes", "trailers"] as const;
export type CatalogList = (typeof catalogLists)[number];
export type Game = "ets2" | "ats";
export type CatalogKind = "city" | "cargo" | "trailer";
export type { AdrClass } from "@vtc/db/catalogs-schema";
export { adrClasses };

export const CATALOG_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const CATALOG_IMPORT_MAX_ROWS = 5000;
export const CATALOG_IMPORT_TOKEN_TTL_MS = 30 * 60 * 1000;
export const CATALOG_PREVIEW_MAX_LINES = 500;

export interface CatalogConfig {
  cursorKey: string;
}
export function validateCatalogConfig(config: CatalogConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_CATALOG_CONFIG");
}

/** Import columns per list; a file header must carry exactly this set, in any order. */
export const importColumns: Readonly<Record<CatalogList, readonly string[]>> = {
  dlcs: ["game", "code", "name_en", "name_ru", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code"],
  cargoes: ["game", "code", "name_en", "name_ru", "adr_class", "dlc_code"],
  trailers: ["game", "code", "name_en", "name_ru", "dlc_code"],
};

/** A code is opaque telemetry bytes: never trimmed or rewritten, only bounded or rejected. */
export function validCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value) <= 128 &&
    Buffer.from(value).toString() === value &&
    /^\S+$/u.test(value) &&
    ![...value].some((ch) => ch <= "\u001f" || ch === "\u007f")
  );
}
