import { type RefObject, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Select } from "../../shared/ui/primitives.js";
import { periods } from "../dashboard/model.js";
import { SEARCH_LIMIT, type tripListFilters } from "./list-model.js";
import { tripSourceLabels, tripSources } from "./transport.js";

type Filters = ReturnType<typeof tripListFilters>;

export function TripListFilters({
  filters,
  effectivePeriod,
  search,
  searchRef,
  onSearch,
  onChange,
  onReset,
  matches,
}: {
  filters: Filters;
  effectivePeriod: Filters["period"];
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (value: string) => void;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
  matches: string;
}) {
  const { t } = useTranslation("trips");
  const [expanded, setExpanded] = useState(false);
  const fieldsId = useId();
  const filterCount = [
    filters.game,
    filters.decision,
    filters.source,
    filters.period,
    filters.ownerId,
  ].filter(Boolean).length;
  const canReset = filterCount > 0 || !!search || filters.order !== "completion_desc";
  return (
    <fieldset className="trips-filter-group" aria-label={t("filters")}>
      <div className="trips-toolbar">
        <div className="trips-search">
          <Label htmlFor="trip-search" className="visually-hidden">
            {t("searchPlaceholder")}
          </Label>
          <Input
            ref={searchRef}
            id="trip-search"
            type="search"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(event) =>
              onSearch(Array.from(event.target.value).slice(0, SEARCH_LIMIT).join(""))
            }
          />
        </div>
        <Button
          className="trips-filter-toggle"
          type="button"
          variant="outline"
          aria-controls={fieldsId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {filterCount ? t("activeFilters", { count: filterCount }) : t("filters")}
        </Button>
        <div className="trips-filter-fields" id={fieldsId} data-expanded={expanded}>
          <div className="trips-filter trips-filter-game">
            <Label htmlFor="trip-game" className="visually-hidden">
              {t("game")}
            </Label>
            <Select
              id="trip-game"
              value={filters.game ?? ""}
              onChange={(e) => onChange("game", e.target.value)}
            >
              <option value="">{t("allGames")}</option>
              <option value="ets2">ETS2</option>
              <option value="ats">ATS</option>
            </Select>
          </div>
          {filters.scope === "mine" && (
            <div className="trips-filter trips-filter-decision">
              <Label htmlFor="trip-decision" className="visually-hidden">
                {t("decision")}
              </Label>
              <Select
                id="trip-decision"
                value={filters.decision ?? ""}
                onChange={(e) => onChange("decision", e.target.value)}
              >
                <option value="">{t("anyDecision")}</option>
                {["unassessed", "pending_review", "accepted", "rejected"].map((decision) => (
                  <option value={decision} key={decision}>
                    {t(decision)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="trips-filter trips-filter-source">
            <Label htmlFor="trip-source" className="visually-hidden">
              {t("sourceFilter")}
            </Label>
            <Select
              id="trip-source"
              value={filters.source ?? ""}
              onChange={(e) => onChange("source", e.target.value)}
            >
              <option value="">{t("anySource")}</option>
              {tripSources.map((source) => (
                <option value={source} key={source}>
                  {t(tripSourceLabels[source])}
                </option>
              ))}
            </Select>
          </div>
          <div className="trips-filter trips-filter-period">
            <Label htmlFor="trip-period" className="visually-hidden">
              {t("period")}
            </Label>
            <Select
              id="trip-period"
              value={effectivePeriod ?? ""}
              onChange={(e) => onChange("period", e.target.value)}
            >
              <option value="">{t("allTime")}</option>
              {periods.map((period) => (
                <option value={period} key={period}>
                  {t(period)}
                </option>
              ))}
            </Select>
          </div>
          <div className="trips-filter trips-filter-order">
            <Label htmlFor="trip-order" className="visually-hidden">
              {t("completionOrder")}
            </Label>
            <Select
              id="trip-order"
              value={filters.order}
              onChange={(e) => onChange("order", e.target.value)}
            >
              <option value="completion_desc">{t("newestFirst")}</option>
              <option value="completion_asc">{t("oldestFirst")}</option>
            </Select>
          </div>
          {canReset && (
            <Button type="button" variant="ghost" className="trips-reset" onClick={onReset}>
              {t("resetTripFilters")}
            </Button>
          )}
        </div>
        <span className="trips-matches" role="status">
          {matches}
        </span>
      </div>
    </fieldset>
  );
}
