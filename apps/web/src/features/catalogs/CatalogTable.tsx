import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { CatalogItem, CatalogList } from "../../shared/catalog-selectors/contracts.js";
import { formatDecimal } from "../../shared/formatting.js";
import { Button, Table } from "../../shared/ui/primitives.js";
import { type CatalogRowFormat, CatalogUpdatedAt, MissingMetadata } from "./CatalogRowMetadata.js";
import { CompanyLogo } from "./CompanyLogo.js";
import { fallbackBadge, isTranslatable, tabLabels } from "./model.js";

export const adrText = (t: TFunction<"catalogs">, item: CatalogItem) =>
  item.adrClass ? t("adrClass", { class: item.adrClass }) : t("nonHazardous");

export function RowBadges({ list, item }: { list: CatalogList; item: CatalogItem }) {
  const { t } = useTranslation("catalogs");
  return (
    <>
      {item.hidden && <span className="catalog-badge">{t("hidden")}</span>}
      {fallbackBadge(list, item) && <span className="catalog-badge">{t("rowFallback")}</span>}
    </>
  );
}

export function CatalogTable({
  list,
  items,
  locale,
  timezone,
  staff,
  busy,
  onEdit,
  onToggleHidden,
}: CatalogRowFormat & {
  list: CatalogList;
  items: CatalogItem[];
  staff: boolean;
  busy: boolean;
  onEdit: (item: CatalogItem) => void;
  onToggleHidden: (item: CatalogItem) => void;
}) {
  const { t } = useTranslation("catalogs");
  const translated = isTranslatable(list);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: The table can overflow on tablet and needs keyboard scrolling.
    <section className="catalog-table-wrap" aria-label={t(tabLabels[list])} tabIndex={0}>
      <Table className="catalog-table" data-testid="catalog-table" data-list={list}>
        <thead>
          <tr>
            <th>{t("colName")}</th>
            {translated && <th>{t("colNameRu")}</th>}
            {list === "cities" && <th>{t("colNameNative")}</th>}
            <th>{t("colCode")}</th>
            {list !== "dlcs" && <th>{t("colDlc")}</th>}
            {list === "cities" && <th>{t("colRegion")}</th>}
            {list === "cargoes" && <th>{t("colAdr")}</th>}
            {list === "dlcs" && <th>{t("colSteam")}</th>}
            {list === "companies" && <th>{t("colDepotCount")}</th>}
            <th>{t("colUpdatedAt")}</th>
            {staff && <th>{t("colActions")}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} data-hidden={item.hidden}>
              <td className="catalog-name">
                {list === "companies" ? (
                  <span className="catalog-company">
                    <CompanyLogo companyId={item.id} logo={item.logo} />
                    <span>
                      {item.nameEn} <RowBadges list={list} item={item} />
                    </span>
                  </span>
                ) : (
                  <>
                    {item.nameEn} <RowBadges list={list} item={item} />
                  </>
                )}
              </td>
              {translated && <td className="catalog-name-ru">{item.nameRu ?? "—"}</td>}
              {list === "cities" && <td>{item.nameNative ?? "—"}</td>}
              <td className="catalog-code">
                <code>{item.code}</code>
              </td>
              {list !== "dlcs" && (
                <td className="catalog-source">{item.dlc?.label ?? t("baseGame")}</td>
              )}
              {list === "cities" && <td>{item.region?.label ?? "—"}</td>}
              {list === "cargoes" && <td>{adrText(t, item)}</td>}
              {list === "dlcs" && <td>{item.steamAppId ?? "—"}</td>}
              {list === "companies" && (
                <td>
                  {item.depotCount === undefined ? (
                    <MissingMetadata />
                  ) : (
                    formatDecimal(String(item.depotCount), locale)
                  )}
                </td>
              )}
              <td className="catalog-updated">
                <CatalogUpdatedAt value={item.updatedAt} locale={locale} timezone={timezone} />
              </td>
              {staff && (
                <td className="catalog-actions-cell">
                  <div className="catalog-row-actions">
                    <Button type="button" size="xs" variant="ghost" onClick={() => onEdit(item)}>
                      {t("edit")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onToggleHidden(item)}
                    >
                      {t(item.hidden ? "restore" : "hide")}
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
