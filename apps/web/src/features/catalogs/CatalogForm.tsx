import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  adrClasses,
  type CatalogItem,
  type CatalogList,
  type Game,
  itemSchema,
  listSchema,
} from "../../shared/catalog-selectors/contracts.js";
import { useCatalogPages } from "../../shared/catalog-selectors/queries.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./Feedback.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

function ParentSelect({
  list,
  game,
  id,
  value,
  emptyLabel,
  onChange,
}: {
  list: "dlcs" | "regions";
  game: Game;
  id: string;
  value: string | null;
  emptyLabel: string;
  onChange: (value: string | null) => void;
}) {
  const { i18n } = useTranslation("catalogs");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const query = useCatalogPages(
    ["parent", list, game, locale],
    `/catalogs/${list}`,
    { game, locale, includeHidden: "true" },
    listSchema,
  );
  const items = query.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);
  return (
    <select
      id={id}
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{emptyLabel}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.display.label}
        </option>
      ))}
    </select>
  );
}

export interface FormTarget {
  list: CatalogList;
  game: Game;
  item: CatalogItem | null;
}

export function CatalogForm({
  target,
  onClose,
  onSaved,
}: {
  target: FormTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("catalogs");
  const id = useId();
  const { list, game, item } = target;
  const [code, setCode] = useState(item?.code ?? ""),
    [nameEn, setNameEn] = useState(item?.nameEn ?? ""),
    [nameRu, setNameRu] = useState(item?.nameRu ?? ""),
    [steam, setSteam] = useState(item?.steamAppId?.toString() ?? ""),
    [dlcId, setDlcId] = useState<string | null>(item?.dlcId ?? null),
    [regionId, setRegionId] = useState<string | null>(item?.regionId ?? null),
    [adrClass, setAdrClass] = useState<string>(item?.adrClass ?? ""),
    [showRequired, setShowRequired] = useState(false);
  const command = useCatalogCommand();
  const steamNumber = steam.trim() === "" ? null : Number(steam);
  const steamValid =
    steamNumber === null ||
    (Number.isInteger(steamNumber) && steamNumber > 0 && steamNumber <= 4294967295);
  const canSave = code.trim() !== "" && nameEn.trim() !== "" && steamValid;
  async function submit() {
    if (!canSave) {
      setShowRequired(true);
      return;
    }
    const body: Record<string, unknown> = {
      code,
      nameEn,
      nameRu: nameRu === "" ? null : nameRu,
      ...(list === "dlcs" ? { steamAppId: steamNumber } : { dlcId }),
      ...(list === "cities" ? { regionId } : {}),
      ...(list === "cargoes" ? { adrClass: adrClass === "" ? null : adrClass } : {}),
    };
    const result = item
      ? await command.run(`/admin/catalogs/${list}/${item.id}`, body, itemSchema, {
          method: "PATCH",
        })
      : await command.run(`/admin/catalogs/${list}`, { game, ...body }, itemSchema);
    if (result) onSaved();
  }
  const codeError = command.errorCode === "CATALOG_CODE_CONFLICT" ? t("errorCodeTaken") : undefined;
  const tabLabel =
    list === "dlcs"
      ? "tabDlcs"
      : list === "regions"
        ? "tabRegions"
        : list === "cities"
          ? "tabCities"
          : list === "cargoes"
            ? "tabCargoes"
            : "tabTrailers";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="catalog-dialog">
        <DialogTitle>
          {t(item ? "formTitleEdit" : "formTitleNew", {
            list: t(tabLabel),
            game: game.toUpperCase(),
          })}
        </DialogTitle>
        <div className="catalog-field">
          <Label htmlFor={`${id}-code`}>{t("fieldCode")}</Label>
          <Input
            id={`${id}-code`}
            maxLength={128}
            autoComplete="off"
            value={code}
            aria-invalid={!!codeError}
            onChange={(e) => setCode(e.target.value)}
          />
          {codeError ? (
            <p role="alert" className="field-error">
              {codeError}
            </p>
          ) : (
            <p className="field-hint">{t(list === "trailers" ? "trailerCodeHint" : "codeHint")}</p>
          )}
        </div>
        <div className="catalog-field">
          <Label htmlFor={`${id}-en`}>{t("fieldNameEn")}</Label>
          <Input
            id={`${id}-en`}
            maxLength={256}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
        <div className="catalog-field">
          <Label htmlFor={`${id}-ru`}>{t("fieldNameRu")}</Label>
          <Input
            id={`${id}-ru`}
            maxLength={256}
            value={nameRu}
            onChange={(e) => setNameRu(e.target.value)}
          />
        </div>
        {list === "dlcs" && (
          <div className="catalog-field">
            <Label htmlFor={`${id}-steam`}>{t("fieldSteam")}</Label>
            <Input
              id={`${id}-steam`}
              inputMode="numeric"
              value={steam}
              aria-invalid={!steamValid}
              onChange={(e) => setSteam(e.target.value)}
            />
          </div>
        )}
        {list === "cities" && (
          <div className="catalog-field">
            <Label htmlFor={`${id}-region`}>{t("fieldRegion")}</Label>
            <ParentSelect
              list="regions"
              game={game}
              id={`${id}-region`}
              value={regionId}
              emptyLabel={t("regionNone")}
              onChange={setRegionId}
            />
          </div>
        )}
        {list === "cargoes" && (
          <div className="catalog-field">
            <Label htmlFor={`${id}-adr`}>{t("fieldAdr")}</Label>
            <select
              id={`${id}-adr`}
              className="input"
              value={adrClass}
              onChange={(e) => setAdrClass(e.target.value)}
            >
              <option value="">{t("nonHazardous")}</option>
              {adrClasses.map((value) => (
                <option key={value} value={value}>
                  {t("adrClass", { class: value })}
                </option>
              ))}
            </select>
          </div>
        )}
        {list !== "dlcs" && (
          <div className="catalog-field">
            <Label htmlFor={`${id}-dlc`}>{t("fieldDlc")}</Label>
            <ParentSelect
              list="dlcs"
              game={game}
              id={`${id}-dlc`}
              value={dlcId}
              emptyLabel={t("baseGame")}
              onChange={setDlcId}
            />
          </div>
        )}
        {showRequired && !canSave && (
          <p role="alert" className="field-error">
            {t("errorRequired")}
          </p>
        )}
        {command.errorCode === "CATALOG_PARENT_INVALID" && (
          <p role="alert" className="field-error">
            {t("errorParent")}
          </p>
        )}
        {!codeError && command.errorCode !== "CATALOG_PARENT_INVALID" && (
          <Failure error={command.failure} seconds={command.seconds} />
        )}
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
