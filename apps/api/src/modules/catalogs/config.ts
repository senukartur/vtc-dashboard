import { adrClasses } from "@vtc/db/catalogs-schema";

export const catalogLists = [
  "dlcs",
  "regions",
  "cities",
  "companies",
  "cargoes",
  "trailers",
] as const;
export type CatalogList = (typeof catalogLists)[number];
/** Depots are not a plain list but share the import flow. */
export type ImportList = CatalogList | "depots";
export type Game = "ets2" | "ats";
export type CatalogKind = "city" | "cargo" | "trailer";
/**
 * Lists named only by their canonical game name: they carry no translation, so a stored
 * Russian name is never shown, searched, filtered or written. Depots read their company's name.
 */
export const canonicalLists: readonly CatalogList[] = ["dlcs", "companies"];
export const isCanonicalList = (list: CatalogList) => canonicalLists.includes(list);
export type { AdrClass } from "@vtc/db/catalogs-schema";
export { adrClasses };

export const CATALOG_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const CATALOG_IMPORT_MAX_ROWS = 5000;
export const CATALOG_IMPORT_TOKEN_TTL_MS = 30 * 60 * 1000;
export const CATALOG_PREVIEW_MAX_LINES = 500;

// Engineering bounds for company logos; they are not product policy.
export const CATALOG_LOGO_MAX_BYTES = 32 * 1024;
export const CATALOG_LOGO_MAX_WIDTH = 128;
export const CATALOG_LOGO_MAX_HEIGHT = 32;
export const CATALOG_LOGO_BULK_MAX_FILES = 500;
export const CATALOG_LOGO_BULK_MAX_BYTES = 16 * 1024 * 1024;

export interface CatalogConfig {
  cursorKey: string;
}
export function validateCatalogConfig(config: CatalogConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_CATALOG_CONFIG");
}

/** Import columns per list; a header carries exactly this set, in any order, minus optional ones. */
export const importColumns: Readonly<Record<ImportList, readonly string[]>> = {
  dlcs: ["game", "code", "name_en", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code", "name_native"],
  companies: ["game", "code", "name_en", "dlc_code"],
  depots: ["game", "company_code", "city_code", "dlc_code"],
  cargoes: ["game", "code", "name_en", "name_ru", "adr_class", "dlc_code"],
  trailers: ["game", "code", "name_en", "name_ru", "dlc_code"],
};

/** Columns a file header may leave out; an absent column reads as an empty cell. */
export const optionalImportColumns: Readonly<Partial<Record<ImportList, readonly string[]>>> = {
  cities: ["name_native"],
};

/**
 * Columns a file may still carry for compatibility but that are never read: canonical lists keep
 * accepting the `name_ru` column older exports and extractors write, and drop its values.
 */
export const ignoredImportColumns: Readonly<Partial<Record<ImportList, readonly string[]>>> = {
  dlcs: ["name_ru"],
  companies: ["name_ru"],
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
