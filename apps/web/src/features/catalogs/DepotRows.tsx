import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button, Table } from "../../shared/ui/primitives.js";
import { type CatalogRowFormat, CatalogUpdatedAt } from "./CatalogRowMetadata.js";
import { CompanyLogo } from "./CompanyLogo.js";
import type { Depot } from "./DepotForm.js";

interface RowActions extends CatalogRowFormat {
  depots: Depot[];
  staff: boolean;
  busy: boolean;
  onEdit: (depot: Depot) => void;
  onToggleHidden: (depot: Depot) => void;
}

/** The hidden badge for the depot itself or a hidden company or city it points at. */
function DepotBadges({ depot }: { depot: Depot }) {
  const { t } = useTranslation("catalogs");
  const hidden = depot.hidden || depot.company.label.hidden || depot.city.label.hidden;
  return <>{hidden && <span className="catalog-badge">{t("hidden")}</span>}</>;
}

const rowHidden = (depot: Depot) =>
  depot.hidden || depot.company.label.hidden || depot.city.label.hidden;

export function DepotTable({
  depots,
  locale,
  timezone,
  staff,
  busy,
  onEdit,
  onToggleHidden,
}: RowActions) {
  const { t } = useTranslation("catalogs");
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: The table can overflow on tablet and needs keyboard scrolling.
    <section className="catalog-table-wrap" aria-label={t("tabDepots")} tabIndex={0}>
      <Table className="catalog-table" data-testid="catalog-table" data-list="depots">
        <thead>
          <tr>
            <th>{t("colCompany")}</th>
            <th>{t("colCity")}</th>
            <th>{t("colDlc")}</th>
            <th>{t("colUpdatedAt")}</th>
            {staff && <th>{t("colActions")}</th>}
          </tr>
        </thead>
        <tbody>
          {depots.map((depot) => (
            <tr key={depot.id} data-hidden={rowHidden(depot)}>
              <td className="catalog-name">
                <span className="catalog-company">
                  <CompanyLogo companyId={depot.company.id} logo={depot.company.logo} />
                  <span>
                    {depot.company.label.label} <DepotBadges depot={depot} />
                    {/* One brand can be several companies (one per facility type); the code tells them apart. */}
                    <code className="catalog-depot-code">{depot.company.code}</code>
                  </span>
                </span>
              </td>
              <td>
                {depot.city.label.label}
                <CatalogNativeName value={depot.city.label} />
              </td>
              <td className="catalog-source">{depot.dlc?.label ?? t("baseGame")}</td>
              <td className="catalog-updated">
                <CatalogUpdatedAt value={depot.updatedAt} locale={locale} timezone={timezone} />
              </td>
              {staff && (
                <td className="catalog-actions-cell">
                  <div className="catalog-row-actions">
                    <Button type="button" size="xs" variant="ghost" onClick={() => onEdit(depot)}>
                      {t("edit")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onToggleHidden(depot)}
                    >
                      {t(depot.hidden ? "restore" : "hide")}
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

export function DepotCards({
  depots,
  locale,
  timezone,
  staff,
  busy,
  onEdit,
  onToggleHidden,
}: RowActions) {
  const { t } = useTranslation("catalogs");
  const [sheet, setSheet] = useState<Depot | null>(null);
  // The code keeps two companies of one brand in one city apart for the actions button and sheet.
  const name = (depot: Depot) =>
    `${depot.company.label.label} (${depot.company.code}) · ${depot.city.label.label}`;
  return (
    <div className="catalog-cards" data-testid="catalog-cards">
      {depots.map((depot) => (
        <div className="catalog-card-row" key={depot.id} data-hidden={rowHidden(depot)}>
          <div className="catalog-card-body">
            <CompanyLogo companyId={depot.company.id} logo={depot.company.logo} />
            <div className="catalog-card-title">
              <span>{depot.company.label.label}</span> <DepotBadges depot={depot} />
            </div>
            <span className="catalog-card-meta">
              <code>{depot.company.code}</code>
              {" · "}
              {depot.city.label.label}
              <CatalogNativeName value={depot.city.label} />
              {` · ${depot.dlc?.label ?? t("baseGame")}`}
            </span>
            <span className="catalog-card-meta">
              {t("colUpdatedAt")}{" "}
              <CatalogUpdatedAt value={depot.updatedAt} locale={locale} timezone={timezone} />
            </span>
          </div>
          {staff && (
            <Button
              type="button"
              variant="outline"
              className="catalog-icon-button"
              aria-label={t("actions", { name: name(depot) })}
              onClick={() => setSheet(depot)}
            >
              …
            </Button>
          )}
        </div>
      ))}
      <Dialog open={!!sheet} onOpenChange={(open) => !open && setSheet(null)}>
        {sheet && (
          <DialogContent className="catalog-dialog">
            <DialogTitle>{t("actions", { name: name(sheet) })}</DialogTitle>
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
