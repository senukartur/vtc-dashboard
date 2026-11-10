import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSelector } from "../../shared/catalog-selectors/CatalogSelector.js";
import type { Game } from "../../shared/catalog-selectors/contracts.js";
import { listSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogPages } from "../../shared/catalog-selectors/queries.js";
import { Input, Label } from "../../shared/ui/primitives.js";
import type { CatalogFilters, CatalogTab } from "./model.js";

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
  tab,
  onChange,
}: {
  filters: CatalogFilters;
  tab: CatalogTab;
  onChange: (patch: Partial<CatalogFilters>) => void;
}) {
  const { t } = useTranslation("catalogs");
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() !== filters.q) onChange({ q: search.trim() });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, filters.q, onChange]);
  return (
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
          checked={filters.hidden}
          onChange={(e) => onChange({ hidden: e.target.checked })}
        />
        {t("showHidden")}
      </label>
    </div>
  );
}
