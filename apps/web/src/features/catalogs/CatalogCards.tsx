import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogItem, CatalogList } from "../../shared/catalog-selectors/contracts.js";
import { formatDecimal } from "../../shared/formatting.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button } from "../../shared/ui/primitives.js";
import { type CatalogRowFormat, CatalogUpdatedAt, MissingMetadata } from "./CatalogRowMetadata.js";
import { adrText, RowBadges } from "./CatalogTable.js";
import { CompanyLogo } from "./CompanyLogo.js";

/** Phone list: same rows as the table, with actions behind one 40px button. */
export function CatalogCards({
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
  const [sheet, setSheet] = useState<CatalogItem | null>(null);
  return (
    <div className="catalog-cards" data-testid="catalog-cards">
      {items.map((item) => (
        <div className="catalog-card-row" key={item.id} data-hidden={item.hidden}>
          <div className="catalog-card-body">
            {list === "companies" && <CompanyLogo companyId={item.id} logo={item.logo} />}
            <div className="catalog-card-title">
              <span>{item.display.label}</span> <RowBadges list={list} item={item} />
            </div>
            <span className="catalog-card-meta">
              <code>{item.code}</code>
              {list === "cities" && item.nameNative ? ` · ${item.nameNative}` : ""}
              {list !== "dlcs" ? ` · ${item.dlc?.label ?? t("baseGame")}` : ""}
              {list === "cities" && item.region ? ` · ${item.region.label}` : ""}
              {list === "cargoes" ? ` · ${adrText(t, item)}` : ""}
            </span>
            {list === "companies" && (
              <span className="catalog-card-meta">
                {item.depotCount === undefined ? (
                  <>
                    {t("colDepotCount")} <MissingMetadata />
                  </>
                ) : (
                  t("depotCount", {
                    count: item.depotCount,
                    value: formatDecimal(String(item.depotCount), locale),
                  })
                )}
              </span>
            )}
            <span className="catalog-card-meta">
              {t("colUpdatedAt")}{" "}
              <CatalogUpdatedAt value={item.updatedAt} locale={locale} timezone={timezone} />
            </span>
          </div>
          {staff && (
            <Button
              type="button"
              variant="outline"
              className="catalog-icon-button"
              aria-label={t("actions", { name: item.display.label })}
              onClick={() => setSheet(item)}
            >
              …
            </Button>
          )}
        </div>
      ))}
      <Dialog open={!!sheet} onOpenChange={(open) => !open && setSheet(null)}>
        {sheet && (
          <DialogContent className="catalog-dialog">
            <DialogTitle>{t("actions", { name: sheet.display.label })}</DialogTitle>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onEdit(sheet);
                setSheet(null);
              }}
            >
              {t("edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onToggleHidden(sheet);
                setSheet(null);
              }}
            >
              {t(sheet.hidden ? "restore" : "hide")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSheet(null)}>
              {t("cancel")}
            </Button>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
