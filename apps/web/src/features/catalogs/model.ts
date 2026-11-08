import {
  type CatalogItem,
  type CatalogList,
  type Game,
  uuid,
} from "../../shared/catalog-selectors/contracts.js";

export const catalogTabs: readonly CatalogList[] = [
  "dlcs",
  "regions",
  "cities",
  "cargoes",
  "trailers",
];
export interface CatalogFilters {
  game: Game;
  tab: CatalogList;
  q: string;
  dlc: string;
  region: string;
  hidden: boolean;
}
export function parseFilters(params: URLSearchParams): CatalogFilters {
  const tab = params.get("tab");
  return {
    game: params.get("game") === "ats" ? "ats" : "ets2",
    tab: (catalogTabs as readonly string[]).includes(tab ?? "") ? (tab as CatalogList) : "cities",
    q: (params.get("q") ?? "").slice(0, 128),
    dlc:
      params.get("dlc") === "base" || uuid.safeParse(params.get("dlc")).success
        ? (params.get("dlc") as string)
        : "",
    region: uuid.safeParse(params.get("region")).success ? (params.get("region") as string) : "",
    hidden: params.get("hidden") === "true",
  };
}
/** URL params carrying only non-default filters, in a stable order. */
export function filterParams(filters: CatalogFilters): URLSearchParams {
  const next = new URLSearchParams();
  if (filters.game !== "ets2") next.set("game", filters.game);
  if (filters.tab !== "cities") next.set("tab", filters.tab);
  if (filters.q) next.set("q", filters.q);
  if (filters.tab !== "dlcs" && filters.dlc) next.set("dlc", filters.dlc);
  if (filters.tab === "cities" && filters.region) next.set("region", filters.region);
  if (filters.hidden) next.set("hidden", "true");
  return next;
}
export const fallbackBadge = (item: CatalogItem) => item.display.englishFallback;

export const importColumns: Record<CatalogList, readonly string[]> = {
  dlcs: ["game", "code", "name_en", "name_ru", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code"],
  cargoes: ["game", "code", "name_en", "name_ru", "adr_class", "dlc_code"],
  trailers: ["game", "code", "name_en", "name_ru", "dlc_code"],
};
export function templateCsv(list: CatalogList) {
  return `${importColumns[list].join(",")}\r\n`;
}
export function templateJson(list: CatalogList) {
  const example = Object.fromEntries(importColumns[list].map((column) => [column, ""]));
  return `${JSON.stringify([example], null, 2)}\n`;
}
export function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
export function digest(bytes: ArrayBuffer) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((value) =>
      [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
}
