import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DepotSelector } from "../../shared/catalog-selectors/DepotSelector.js";
import { visibleDepot } from "../../shared/catalog-selectors/depots.js";
import { State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { type DTO, queryString } from "../trips/transport.js";

type Game = DTO["ManualDatedSubmissionFields"]["game"];

/**
 * The chosen company's eligibility: it must have a visible depot in the selected city of the same
 * game. A company that loses it is cleared once, with a notice.
 */
export function useDepotCompany(
  game: Game,
  selection: DTO["ManualCatalogSelection"] | undefined,
  value: string | undefined,
  clear: () => void,
) {
  const { i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const cityId = selection?.status === "resolved" ? selection.entityId : undefined;
  const exact = useTripQuery(
    `/catalogs/depots?${queryString({ game, cityId, locale, companyId: value, limit: 1 })}`,
    "EnvelopeCatalogDepotList",
    !!cityId && !!value,
  );
  const eligible = cityId
    ? exact.data?.data.data.items.find(
        (depot) => visibleDepot(depot, game, cityId) && depot.company.id === value,
      )?.company
    : undefined;
  const incompatible = !!value && (!cityId || (!!exact.data && !eligible));
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (!incompatible) return;
    setCleared(`${game}:${cityId ?? ""}`);
    clear();
  }, [incompatible, clear, game, cityId]);
  return {
    game,
    cityId,
    exact,
    selected: eligible
      ? { id: eligible.id, label: eligible.label.label, code: eligible.code }
      : undefined,
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
  const { game, cityId, exact, selected, cleared } = choices;
  const hint = !cityId ? "companyChooseCity" : undefined;
  return (
    <div className="field manual-company-field">
      <DepotSelector
        id={name}
        label={t(`${name}Optional`)}
        game={game}
        cityId={cityId}
        value={value ?? null}
        selected={selected}
        selectedPending={!!value && exact.isPending}
        describedBy={hint || cleared ? `${name}-hint` : undefined}
        emptyText={t("companyNone")}
        onChange={(next) => {
          choices.clearNotice();
          onChange(next ?? undefined);
        }}
      />
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
      {cityId && value && <State query={exact} />}
    </div>
  );
}
