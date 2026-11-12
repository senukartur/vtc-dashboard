import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { itemSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { formatUtc } from "../../shared/formatting.js";
import { CatalogName } from "../trips/TripTable.js";
import { type DTO, revisionFields } from "../trips/transport.js";
import { formatDamage } from "./model.js";
import { displayTimezone } from "./reference-time.js";

function CompanyName({
  id,
  game,
}: {
  id: string | undefined;
  game: DTO["ManualReportReadFields"]["game"];
}) {
  const { t, i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const query = useCatalogQuery(
    ["manual-reference-company", game, id, locale],
    `/catalogs/companies/${id}?locale=${locale}`,
    itemSchema,
    !!id,
  );
  if (!id) return t("notSpecified");
  if (query.isPending) return <span role="status">{t("loading")}</span>;
  const item = query.data?.data.data;
  return <CatalogName value={item?.id === id && item.game === game ? item.display : null} />;
}

export function ReferenceFacts({ revision }: { revision: DTO["ManualRevisionRead"] }) {
  const { t, i18n } = useTranslation("trips");
  const session = useSession();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const timezone = displayTimezone(session.self?.preferences.displayTimezone);
  const fields = revisionFields(revision);
  const { cargoDamagePercent } = fields;
  return (
    <section className="stack manual-reference-facts" aria-label={t("referenceFacts")}>
      <h3>{t("referenceFacts")}</h3>
      <p className="muted">{t("referenceHelp", { timezone })}</p>
      <dl className="trip-facts">
        {(["originCompanyId", "destinationCompanyId"] as const).map((name) => (
          <div key={name}>
            <dt>{t(name)}</dt>
            <dd>
              <CompanyName id={fields[name]} game={fields.game} />
            </dd>
          </div>
        ))}
        {(["startedAt", "completedAt"] as const).map((name) => (
          <div key={name}>
            <dt>{t(name)}</dt>
            <dd>
              {fields[name] ? (
                <time dateTime={fields[name]}>{formatUtc(fields[name], locale, timezone)}</time>
              ) : (
                t("notSpecified")
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt>{t("cargoDamagePercent")}</dt>
          <dd>
            {cargoDamagePercent === undefined
              ? t("notSpecified")
              : `${formatDamage(cargoDamagePercent, locale)} %`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
