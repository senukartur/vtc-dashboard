import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogPages } from "../../shared/catalog-selectors/queries.js";
import { Button, Label } from "../../shared/ui/primitives.js";
import { State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { type DTO, queryString, schema } from "../trips/transport.js";

type Game = DTO["ManualDatedSubmissionFields"]["game"];

function visibleDepot(depot: DTO["CatalogDepot"], game: Game, cityId: string | undefined) {
  return (
    depot.game === game &&
    depot.city.id === cityId &&
    !depot.hidden &&
    !depot.city.label.hidden &&
    !depot.company.label.hidden
  );
}

export function useDepotCompany(
  game: Game,
  selection: DTO["ManualCatalogSelection"] | undefined,
  value: string | undefined,
  clear: () => void,
) {
  const { i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const cityId = selection?.status === "resolved" ? selection.entityId : undefined;
  const params = { game, cityId, locale };
  const exact = useTripQuery(
    `/catalogs/depots?${queryString({ ...params, companyId: value, limit: 1 })}`,
    "EnvelopeCatalogDepotList",
    !!cityId && !!value,
  );
  const eligible = exact.data?.data.data.items.find(
    (depot) => visibleDepot(depot, game, cityId) && depot.company.id === value,
  )?.company;
  const incompatible = !!value && (!cityId || (!!exact.data && !eligible));
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (!incompatible) return;
    setCleared(`${game}:${cityId ?? ""}`);
    clear();
  }, [incompatible, clear, game, cityId]);

  const pages = useCatalogPages(
    ["manual-depots"],
    "/catalogs/depots",
    params,
    schema("CatalogDepotList"),
    !!cityId,
  );
  const companies = new Map<string, DTO["CatalogDepotCompany"]>();
  for (const page of pages.data?.pages ?? [])
    for (const depot of page.data.data.items)
      if (visibleDepot(depot, game, cityId)) companies.set(depot.company.id, depot.company);
  if (eligible) companies.set(eligible.id, eligible);
  return {
    cityId,
    companies,
    pages,
    exact,
    blocked: !!value && !eligible,
    cleared: !value && cleared === `${game}:${cityId ?? ""}`,
    clearNotice: () => setCleared(null),
  };
}

export function DepotCompanyField({
  name,
  value,
  onChange,
  choices,
}: {
  name: "originCompanyId" | "destinationCompanyId";
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  choices: ReturnType<typeof useDepotCompany>;
}) {
  const { t } = useTranslation("trips");
  const { cityId, companies, pages, exact, cleared } = choices;
  const pendingSelection = value && !companies.has(value);
  const optionsLoading = !!cityId && pages.isPending;
  const empty = !!cityId && !!pages.data && companies.size === 0 && !value;
  const hint = !cityId ? "companyChooseCity" : empty ? "companyNone" : undefined;
  return (
    <div className="field manual-company-field">
      <Label htmlFor={name}>{t(`${name}Optional`)}</Label>
      <select
        id={name}
        className="input"
        value={value ?? ""}
        disabled={!cityId || (!value && (optionsLoading || empty || pages.isError))}
        aria-describedby={hint || cleared ? `${name}-hint` : undefined}
        onChange={(event) => {
          choices.clearNotice();
          onChange(event.target.value || undefined);
        }}
      >
        <option value="">{t("notSpecified")}</option>
        {pendingSelection && (
          <option value={value}>{t(exact.isError ? "unknown" : "companyChecking")}</option>
        )}
        {[...companies.values()].map(({ id, label }) => (
          <option key={id} value={id}>
            {label.label}
            {label.englishFallback ? ` · ${t("catalogs:fallback")}` : ""}
          </option>
        ))}
      </select>
      {cleared ? (
        <p id={`${name}-hint`} className="manual-report-hint" role="status">
          {t("companyCleared")}
        </p>
      ) : (
        hint && (
          <p id={`${name}-hint`} className="manual-report-hint">
            {t(hint)}
          </p>
        )
      )}
      {cityId && <State query={pages} />}
      {cityId && value && <State query={exact} />}
      {pages.hasNextPage && !pages.isError && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {t("companyMore")}
        </Button>
      )}
    </div>
  );
}
