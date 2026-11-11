import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSelector } from "../../shared/catalog-selectors/CatalogSelector.js";
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";
import { listSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogPages } from "../../shared/catalog-selectors/queries.js";
import { formatDecimal } from "../../shared/formatting.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import type { CatalogFilters, MaintenanceMode } from "./model.js";

function ParentFilter({
  list,
  game,
  value,
  onChange,
  label,
  emptyLabel,
  extra,
}: {
  list: "dlcs" | "regions";
  game: Game;
  value: string;
  onChange: (value: string) => void;
  label: string;
  emptyLabel: string;
  extra?: { value: string; label: string };
}) {
  const { i18n } = useTranslation("catalogs");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const query = useCatalogPages(
    ["filter", list, game, locale],
    `/catalogs/${list}`,
    { game, locale, includeHidden: "true" },
    listSchema,
  );
  const items = query.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);
  const id = `catalog-filter-${list}`;
  return (
    <div>
      <Label htmlFor={id} className="visually-hidden">
        {label}
      </Label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {extra && <option value={extra.value}>{extra.label}</option>}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.display.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CatalogToolbar({
  filters,
  summary,
  summaryPending,
  onChange,
}: {
  filters: CatalogFilters;
  summary: CatalogDTO["CatalogSummary"]["lists"] | undefined;
  summaryPending: boolean;
  onChange: (patch: Partial<CatalogFilters>) => void;
}) {
  const { t, i18n } = useTranslation("catalogs");
  const { tab, maintenance } = filters;
  const countId = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const chips: { mode: MaintenanceMode; label: string; count: number | undefined }[] = [
    { mode: "hidden", label: t("hiddenOnly"), count: summary?.[tab].hidden },
    { mode: "untranslated", label: t("untranslated"), count: summary?.[tab].untranslated },
  ];
  if (tab === "companies")
    chips.push({
      mode: "missingLogo",
      label: t("missingLogo"),
      count: summary?.companies.missingLogo,
    });
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() !== filters.q) onChange({ q: search.trim() });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, filters.q, onChange]);
  return (
    <>
      <div className="catalog-toolbar">
        <Label htmlFor="catalog-search" className="visually-hidden">
          {t("searchLabel")}
        </Label>
        <Input
          id="catalog-search"
          type="search"
          maxLength={128}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab !== "dlcs" && (
          <ParentFilter
            list="dlcs"
            game={filters.game}
            value={filters.dlc}
            onChange={(dlc) => onChange({ dlc })}
            label={t("dlcFilter")}
            emptyLabel={t("allDlcs")}
            extra={{ value: "base", label: t("baseGame") }}
          />
        )}
        {tab === "cities" && (
          <ParentFilter
            list="regions"
            game={filters.game}
            value={filters.region}
            onChange={(region) => onChange({ region })}
            label={t("regionFilter")}
            emptyLabel={t("allRegions")}
          />
        )}
        {tab === "depots" && (
          <>
            <CatalogSelector
              label={t("companyFilter")}
              labelHidden
              game={filters.game}
              kind="company"
              value={filters.company || null}
              onChange={(company) => onChange({ company: company ?? "" })}
            />
            <CatalogSelector
              label={t("cityFilter")}
              labelHidden
              game={filters.game}
              kind="city"
              value={filters.city || null}
              onChange={(city) => onChange({ city: city ?? "" })}
            />
          </>
        )}
        <label className="catalog-check">
          <input
            type="checkbox"
            checked={maintenance === "all"}
            onChange={(e) => onChange({ maintenance: e.target.checked ? "all" : null })}
          />
          {t("showHidden")}
        </label>
      </div>
      <fieldset className="catalog-maintenance">
        <legend className="visually-hidden">{t("maintenanceFilters")}</legend>
        {chips.map(({ mode, label, count }) => (
          <Button
            key={mode}
            type="button"
            variant="outline"
            size="sm"
            aria-label={label}
            aria-describedby={countId + mode}
            aria-pressed={maintenance === mode}
            onClick={() => onChange({ maintenance: maintenance === mode ? null : mode })}
          >
            {label}
            <span className="catalog-chip-count" id={countId + mode}>
              {count === undefined ? (
                <>
                  <span aria-hidden="true">{summaryPending ? "…" : "—"}</span>
                  <span className="visually-hidden">
                    {t(summaryPending ? "countLoading" : "countUnavailable")}
                  </span>
                </>
              ) : (
                formatDecimal(String(count), locale)
              )}
            </span>
          </Button>
        ))}
      </fieldset>
    </>
  );
}
