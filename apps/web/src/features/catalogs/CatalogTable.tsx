import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { CatalogItem, CatalogList } from "../../shared/catalog-selectors/contracts.js";
import { Button, Table } from "../../shared/ui/primitives.js";

export const adrText = (t: TFunction<"catalogs">, item: CatalogItem) =>
  item.adrClass ? t("adrClass", { class: item.adrClass }) : t("nonHazardous");

export function RowBadges({ item }: { item: CatalogItem }) {
  const { t } = useTranslation("catalogs");
  return (
    <>
      {item.hidden && <span className="catalog-badge">{t("hidden")}</span>}
      {item.display.englishFallback && <span className="catalog-badge">{t("rowFallback")}</span>}
    </>
  );
}

export function CatalogTable({
  list,
  items,
  staff,
  busy,
  onEdit,
  onToggleHidden,
}: {
  list: CatalogList;
  items: CatalogItem[];
  staff: boolean;
  busy: boolean;
  onEdit: (item: CatalogItem) => void;
  onToggleHidden: (item: CatalogItem) => void;
}) {
  const { t } = useTranslation("catalogs");
  return (
    <div className="catalog-table-wrap">
      <Table className="catalog-table" data-testid="catalog-table">
        <thead>
          <tr>
            <th>{t("colName")}</th>
            <th>{t("colNameRu")}</th>
            <th>{t("colCode")}</th>
            {list !== "dlcs" && <th>{t("colDlc")}</th>}
            {list === "cities" && <th>{t("colRegion")}</th>}
            {list === "cargoes" && <th>{t("colAdr")}</th>}
            {list === "dlcs" && <th>{t("colSteam")}</th>}
            {staff && <th>{t("colActions")}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} data-hidden={item.hidden}>
              <td className="catalog-name">
                {item.nameEn} <RowBadges item={item} />
              </td>
              <td>{item.nameRu ?? "—"}</td>
              <td>
                <code>{item.code}</code>
              </td>
              {list !== "dlcs" && <td>{item.dlc?.label ?? t("baseGame")}</td>}
              {list === "cities" && <td>{item.region?.label ?? "—"}</td>}
              {list === "cargoes" && <td>{adrText(t, item)}</td>}
              {list === "dlcs" && <td>{item.steamAppId ?? "—"}</td>}
              {staff && (
                <td>
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
    </div>
  );
}
