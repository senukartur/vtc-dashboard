import type { TFunction } from "i18next";
import {
  type CatalogDTO,
  type CatalogItem,
  type CatalogList,
  type CatalogLogo,
  type Game,
  uuid,
} from "../../shared/catalog-selectors/contracts.js";

/** The page's tabs: the plain lists plus depots, which pair a company with a city. */
export type CatalogTab = CatalogList | "depots";
export const catalogTabs: readonly CatalogTab[] = [
  "dlcs",
  "regions",
  "cities",
  "companies",
  "depots",
  "cargoes",
  "trailers",
];
export const tabLabels: Record<CatalogTab, string> = {
  dlcs: "tabDlcs",
  regions: "tabRegions",
  cities: "tabCities",
  companies: "tabCompanies",
  depots: "tabDepots",
  cargoes: "tabCargoes",
  trailers: "tabTrailers",
};
export const addLabels: Record<CatalogTab, string> = {
  dlcs: "addDlcs",
  regions: "addRegions",
  cities: "addCities",
  companies: "addCompanies",
  depots: "addDepots",
  cargoes: "addCargoes",
  trailers: "addTrailers",
};
export type MaintenanceMode = "all" | "hidden" | "untranslated" | "missingLogo";
export interface CatalogFilters {
  game: Game;
  tab: CatalogTab;
  q: string;
  dlc: string;
  region: string;
  /** Depots only: show the cities of this company. */
  company: string;
  /** Depots only: show the companies in this city. */
  city: string;
  maintenance: MaintenanceMode | null;
}
/** The authenticated logo image of a company; the version busts the cache when it changes. */
export const logoSrc = (companyId: string, logo: CatalogLogo) =>
  `/api/v1/catalogs/companies/${companyId}/logo?v=${logo.version}`;
export function parseFilters(params: URLSearchParams): CatalogFilters {
  const requestedTab = params.get("tab");
  const tab = catalogTabs.find((value) => value === requestedTab) ?? "cities";
  let maintenance: MaintenanceMode | null = null;
  if (params.get("hidden") === "only") maintenance = "hidden";
  else if (tab === "companies" && params.get("logo") === "missing") maintenance = "missingLogo";
  else if (params.get("untranslated") === "true") maintenance = "untranslated";
  else if (params.get("hidden") === "true") maintenance = "all";
  return {
    game: params.get("game") === "ats" ? "ats" : "ets2",
    tab,
    q: (params.get("q") ?? "").slice(0, 128),
    dlc:
      params.get("dlc") === "base" || uuid.safeParse(params.get("dlc")).success
        ? (params.get("dlc") as string)
        : "",
    region: uuid.safeParse(params.get("region")).success ? (params.get("region") as string) : "",
    company: uuid.safeParse(params.get("company")).success ? (params.get("company") as string) : "",
    city: uuid.safeParse(params.get("city")).success ? (params.get("city") as string) : "",
    maintenance,
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
  if (filters.tab === "depots" && filters.company) next.set("company", filters.company);
  if (filters.tab === "depots" && filters.city) next.set("city", filters.city);
  if (filters.maintenance === "all") next.set("hidden", "true");
  if (filters.maintenance === "hidden") next.set("hidden", "only");
  if (filters.maintenance === "untranslated") next.set("untranslated", "true");
  if (filters.maintenance === "missingLogo" && filters.tab === "companies")
    next.set("logo", "missing");
  return next;
}
/** Effective request arguments also identify the cursor stack for the current endpoint. */
export function catalogListParams(filters: CatalogFilters, locale: "ru" | "en") {
  const { game, tab, q, dlc, region, company, city, maintenance } = filters;
  return {
    game,
    search: q || undefined,
    includeHidden: maintenance === "all" ? "true" : undefined,
    hidden: maintenance === "hidden" ? "only" : undefined,
    untranslated: maintenance === "untranslated" ? "true" : undefined,
    logo: maintenance === "missingLogo" && tab === "companies" ? "missing" : undefined,
    dlc: tab !== "dlcs" ? dlc || undefined : undefined,
    regionId: tab === "cities" ? region || undefined : undefined,
    companyId: tab === "depots" ? company || undefined : undefined,
    cityId: tab === "depots" ? city || undefined : undefined,
    locale,
    limit: 25,
  };
}

export const fallbackBadge = (item: CatalogItem) => item.display.englishFallback;

const importFieldKeys = new Map([
  ["code", "fieldCode"],
  ["game", "game"],
  ["name_en", "fieldNameEn"],
  ["name_ru", "fieldNameRu"],
  ["name_native", "fieldNameNative"],
  ["steam_app_id", "fieldSteam"],
  ["adr_class", "fieldAdr"],
  ["dlc_code", "fieldDlc"],
  ["region_code", "fieldRegion"],
  ["company_code", "fieldCompanyCode"],
  ["city_code", "fieldCityCode"],
  ["file", "fieldFile"],
  ["logo", "fieldLogo"],
]);
const importFieldLabel = (t: TFunction<"catalogs">, field: string): string => {
  const key = importFieldKeys.get(field);
  return key ? t(key) : field;
};
/** A localized dry-run message; codes this build does not know stay readable. */
export function importIssueText(
  t: TFunction<"catalogs">,
  issue: CatalogDTO["CatalogImportIssue"],
): string {
  const field = importFieldLabel(t, issue.field);
  switch (issue.reason) {
    case "required":
      return t("issueRequired", { field });
    case "invalid":
      return t("issueInvalid", { field });
    case "too_long":
      return t("issueTooLong", { field });
    case "duplicate_in_file":
      return t(issue.field === "file" ? "issueDuplicateFile" : "issueDuplicate");
    case "unknown_reference":
      if (issue.field === "dlc_code") return t("issueUnknownDlc");
      if (issue.field === "region_code") return t("issueUnknownRegion");
      if (issue.field === "company_code" || issue.field === "code") return t("issueUnknownCompany");
      if (issue.field === "city_code") return t("issueUnknownCity");
      return t("issueUnknownReference", { field });
    case "hidden_reference":
      if (issue.field === "dlc_code") return t("issueHiddenDlc");
      if (issue.field === "region_code") return t("issueHiddenRegion");
      if (issue.field === "company_code") return t("issueHiddenCompany");
      if (issue.field === "city_code") return t("issueHiddenCity");
      return t("issueHiddenReference", { field });
    case "bad_name":
      return t("issueBadName");
    case "not_png":
      return t("issueNotPng");
    case "too_large":
      return t("issueLogoTooLarge");
    case "bad_dimensions":
      return t("issueBadDimensions");
    case "corrupt":
      return t("issueCorrupt");
    case "column_count":
      return t("issueColumnCount");
    case "invalid_row":
      return t("issueInvalidRow");
    case "unknown_field":
      return t("issueUnknownField", { field: issue.field });
    default:
      return t("issueGeneric", { field, reason: issue.reason });
  }
}
export const importChangedText = (t: TFunction<"catalogs">, fields: readonly string[]) =>
  t("statusChanged", { fields: fields.map((field) => importFieldLabel(t, field)).join(", ") });
/** Rebuilds dry-run lines from an apply rejection's `line:<n>:<field>` details. */
export function importLinesFromDetails(details: unknown): CatalogDTO["CatalogImportLine"][] {
  if (!Array.isArray(details)) return [];
  const lines = new Map<number, CatalogDTO["CatalogImportIssue"][]>();
  for (const detail of details as { field?: unknown; code?: unknown }[]) {
    const match = typeof detail?.field === "string" ? /^line:(\d+):(.+)$/.exec(detail.field) : null;
    if (!match || typeof detail.code !== "string") continue;
    const line = Number(match[1]);
    lines.set(line, [
      ...(lines.get(line) ?? []),
      { field: match[2] as string, reason: detail.code },
    ]);
  }
  return [...lines]
    .sort(([a], [b]) => a - b)
    .map(([line, issues]) => ({ line, code: null, status: "error", issues, changedFields: [] }));
}

export const importColumns: Record<CatalogTab, readonly string[]> = {
  dlcs: ["game", "code", "name_en", "name_ru", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code", "name_native"],
  companies: ["game", "code", "name_en", "name_ru", "dlc_code"],
  depots: ["game", "company_code", "city_code", "dlc_code"],
  cargoes: ["game", "code", "name_en", "name_ru", "adr_class", "dlc_code"],
  trailers: ["game", "code", "name_en", "name_ru", "dlc_code"],
};
export function templateCsv(list: CatalogTab) {
  return `${importColumns[list].join(",")}\r\n`;
}
export function templateJson(list: CatalogTab) {
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
