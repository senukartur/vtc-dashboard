import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSelector } from "../../shared/catalog-selectors/CatalogSelector.js";
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button, Label } from "../../shared/ui/primitives.js";
import { ParentSelect } from "./CatalogForm.js";
import { CompanyLogo } from "./CompanyLogo.js";
import { Failure } from "./Feedback.js";
import { depotSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

export type Depot = CatalogDTO["CatalogDepot"];
export interface DepotTarget {
  game: Game;
  depot: Depot | null;
}

/** Add a company-in-city depot, or change the source of an existing one. */
export function DepotForm({
  target,
  onClose,
  onSaved,
}: {
  target: DepotTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("catalogs");
  const id = useId();
  const { game, depot } = target;
  const [companyId, setCompanyId] = useState<string | null>(depot?.company.id ?? null),
    [cityId, setCityId] = useState<string | null>(depot?.city.id ?? null),
    [dlcId, setDlcId] = useState<string | null>(depot?.dlcId ?? null),
    [showRequired, setShowRequired] = useState(false);
  const command = useCatalogCommand();
  const canSave = !!companyId && !!cityId;
  async function submit() {
    if (!canSave) {
      setShowRequired(true);
      return;
    }
    const result = depot
      ? await command.run(`/admin/catalogs/depots/${depot.id}`, { dlcId }, depotSchema, {
          method: "PATCH",
        })
      : await command.run(
          "/admin/catalogs/depots",
          { game, companyId, cityId, dlcId },
          depotSchema,
        );
    if (result) onSaved();
  }
  const known = command.errorCode === "CATALOG_CODE_CONFLICT" ? "errorDepotExists" : null;
  const parent = command.errorCode === "CATALOG_PARENT_INVALID";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="catalog-dialog">
        <DialogTitle>
          {t(depot ? "depotFormEdit" : "depotFormNew", { game: game.toUpperCase() })}
        </DialogTitle>
        {depot ? (
          <>
            <div className="catalog-field">
              <span className="catalog-field-label">{t("fieldCompany")}</span>
              <span className="catalog-company">
                <CompanyLogo companyId={depot.company.id} logo={depot.company.logo} />
                <span>{depot.company.label.label}</span>
              </span>
            </div>
            <div className="catalog-field">
              <span className="catalog-field-label">{t("fieldCity")}</span>
              <span>{depot.city.label.label}</span>
            </div>
          </>
        ) : (
          <>
            <CatalogSelector
              label={t("fieldCompany")}
              game={game}
              kind="company"
              value={companyId}
              onChange={setCompanyId}
            />
            <CatalogSelector
              label={t("fieldCity")}
              game={game}
              kind="city"
              value={cityId}
              onChange={setCityId}
            />
          </>
        )}
        <div className="catalog-field">
          <Label htmlFor={`${id}-dlc`}>{t("fieldDlc")}</Label>
          <ParentSelect
            list="dlcs"
            game={game}
            id={`${id}-dlc`}
            value={dlcId}
            initial={depot?.dlcId ?? null}
            emptyLabel={t("baseGame")}
            onChange={setDlcId}
          />
        </div>
        {showRequired && !canSave && (
          <p role="alert" className="field-error">
            {t("errorDepotRequired")}
          </p>
        )}
        {known && (
          <p role="alert" className="field-error">
            {t(known)}
          </p>
        )}
        {parent && (
          <p role="alert" className="field-error">
            {t("errorDepotParent")}
          </p>
        )}
        {!known && !parent && <Failure error={command.failure} seconds={command.seconds} />}
        <div className="catalog-dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={command.pending} onClick={() => void submit()}>
            {t("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
