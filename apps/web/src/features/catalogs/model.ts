import type { TFunction } from "i18next";
import {
  type CatalogDTO,
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
      return t("issueDuplicate");
    case "unknown_reference":
      if (issue.field === "dlc_code") return t("issueUnknownDlc");
      if (issue.field === "region_code") return t("issueUnknownRegion");
      return t("issueUnknownReference", { field });
    case "hidden_reference":
      if (issue.field === "dlc_code") return t("issueHiddenDlc");
      if (issue.field === "region_code") return t("issueHiddenRegion");
      return t("issueHiddenReference", { field });
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

export const importColumns: Record<CatalogList, readonly string[]> = {
  dlcs: ["game", "code", "name_en", "name_ru", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code", "name_native"],
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
