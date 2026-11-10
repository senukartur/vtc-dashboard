import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import {
  type CatalogItem,
  catalogParams,
  itemSchema,
  listSchema,
} from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { CatalogCards } from "./CatalogCards.js";
import { CatalogForm, type FormTarget } from "./CatalogForm.js";
import { CatalogImport } from "./CatalogImport.js";
import { CatalogTable } from "./CatalogTable.js";
import { CatalogToolbar } from "./CatalogToolbar.js";
import { type Depot, DepotForm, type DepotTarget } from "./DepotForm.js";
import { DepotCards, DepotTable } from "./DepotRows.js";
import { Failure } from "./Feedback.js";
import { LogoBulkDialog } from "./LogoUpload.js";
import {
  addLabels,
  type CatalogFilters,
  catalogTabs,
  filterParams,
  parseFilters,
  tabLabels,
} from "./model.js";
import { depotListSchema, depotSchema, summarySchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";
import "./catalogs.css";

const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;

/** Gate: without company.read no catalog query hook mounts, so nothing is requested. */
export function CatalogsPage() {
  const { t } = useTranslation("catalogs"),
    session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="catalog-page">
        <header className="catalog-header">
          <h1>{t("title")}</h1>
        </header>
        <Card className="catalog-card">
          <p>{t("pageForbidden")}</p>
        </Card>
      </div>
    );
  return <CatalogWorkspace />;
}

function CatalogWorkspace() {
  const { t, i18n } = useTranslation("catalogs"),
    session = useSession(),
    [params, setParams] = useSearchParams();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const filters = parseFilters(params);
  const staff = !!session.self?.capabilities.includes("qualifications.manage");
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["catalogs"] }),
    [queryClient],
  );
  const filterKey = [
    filters.game,
    filters.tab,
    filters.q,
    filters.dlc,
    filters.region,
    filters.company,
    filters.city,
    filters.hidden,
    locale,
  ].join("/");
  // Cursors belong to one filter set; a changed filter set restarts at the first page.
  const [paging, setPaging] = useState<{ key: string; cursors: string[] }>({
    key: filterKey,
    cursors: [],
  });
  const cursors = paging.key === filterKey ? paging.cursors : [];
  const setCursors = (next: string[]) => setPaging({ key: filterKey, cursors: next });
  const [form, setForm] = useState<FormTarget | null>(null);
  const [depotForm, setDepotForm] = useState<DepotTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadingLogos, setUploadingLogos] = useState(false);
  const depots = filters.tab === "depots";
  // Seven tabs scroll sideways on a phone; the chosen one must not be left out of view.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${filters.tab}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [filters.tab]);
  const plain = filters.tab === "depots" ? null : filters.tab;
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      setParams((previous) => filterParams({ ...parseFilters(previous), ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );
  const cursor = cursors.at(-1);
  const summary = useCatalogQuery(
    ["summary", filters.game],
    `/catalogs/summary?game=${filters.game}`,
    summarySchema,
  );
  const list = useCatalogQuery(
    ["list", filterKey, cursor],
    `/catalogs/${plain ?? "cities"}?${catalogParams({
      game: filters.game,
      search: filters.q || undefined,
      includeHidden: filters.hidden ? "true" : undefined,
      dlc: plain !== "dlcs" ? filters.dlc || undefined : undefined,
      regionId: plain === "cities" ? filters.region || undefined : undefined,
      locale,
      limit: 25,
      cursor,
    })}`,
    listSchema,
    !depots,
  );
  const depotList = useCatalogQuery(
    ["depots", filterKey, cursor],
    `/catalogs/depots?${catalogParams({
      game: filters.game,
      search: filters.q || undefined,
      includeHidden: filters.hidden ? "true" : undefined,
      dlc: filters.dlc || undefined,
      companyId: filters.company || undefined,
      cityId: filters.city || undefined,
      locale,
      limit: 25,
      cursor,
    })}`,
    depotListSchema,
    depots,
  );
  const hide = useCatalogCommand();
  const toggleHidden = useCallback(
    async (item: CatalogItem) => {
      const result = await hide.run(
        `/admin/catalogs/${filters.tab}/${item.id}`,
        { hidden: !item.hidden },
        itemSchema,
        { method: "PATCH" },
      );
      if (result) refresh();
    },
    [hide, filters.tab, refresh],
  );
  const toggleDepot = useCallback(
    async (depot: Depot) => {
      const result = await hide.run(
        `/admin/catalogs/depots/${depot.id}`,
        { hidden: !depot.hidden },
        depotSchema,
        { method: "PATCH" },
      );
      if (result) refresh();
    },
    [hide, refresh],
  );
  const activeQuery = depots ? depotList : list;
  const page = activeQuery.data?.data.data;
  const counts = summary.data?.data.data.lists;
  const openAdd = () =>
    plain
      ? setForm({ list: plain, game: filters.game, item: null })
      : setDepotForm({ game: filters.game, depot: null });
  const openEdit = (item: CatalogItem) =>
    plain && setForm({ list: plain, game: filters.game, item });
  const filtered = !!(
    filters.q ||
    filters.dlc ||
    filters.region ||
    filters.company ||
    filters.city
  );
  const tabLabel = t(tabLabels[filters.tab]);
  return (
    <div className="catalog-page">
      <header className="catalog-header">
        <h1>{t("title")}</h1>
        <SegmentedControl
          aria-label={t("game")}
          className="catalog-game"
          value={filters.game}
          options={games}
          onValueChange={(game) => update({ game, dlc: "", region: "", company: "", city: "" })}
        />
        {staff && (
          <div className="catalog-actions">
            {filters.tab === "companies" && (
              <Button type="button" variant="outline" onClick={() => setUploadingLogos(true)}>
                {t("logoUploadAll")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setImporting(true)}>
              {t("importButton")}
            </Button>
            <Button type="button" onClick={openAdd}>
              {t(addLabels[filters.tab])}
            </Button>
          </div>
        )}
        <p className="catalog-description">{t("description")}</p>
      </header>
      <div ref={tabsRef} className="catalog-tabs" role="tablist" aria-label={t("title")}>
        {catalogTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            data-tab={tab}
            className="catalog-tab"
            aria-selected={tab === filters.tab}
            onClick={() => update({ tab, dlc: "", region: "", company: "", city: "" })}
          >
            {t(tabLabels[tab])}
            {counts && <small>{counts[tab].visible}</small>}
          </button>
        ))}
      </div>
      <Card className="catalog-card">
        <CatalogToolbar filters={filters} tab={filters.tab} onChange={update} />
        {activeQuery.isPending && <p role="status">{t("loading")}</p>}
        {activeQuery.isError && (
          <div role="alert">
            <p>{t("readError")}</p>
            <Button type="button" variant="outline" onClick={() => void activeQuery.refetch()}>
              {t("refresh")}
            </Button>
          </div>
        )}
        {page && page.items.length === 0 && !activeQuery.isPending && (
          <p className="catalog-muted">{t(filtered || filters.hidden ? "empty" : "emptyList")}</p>
        )}
        {depots && depotList.data && depotList.data.data.data.items.length > 0 && (
          <>
            <DepotTable
              depots={depotList.data.data.data.items}
              staff={staff}
              busy={hide.pending}
              onEdit={(depot) => setDepotForm({ game: filters.game, depot })}
              onToggleHidden={(depot) => void toggleDepot(depot)}
            />
            <DepotCards
              depots={depotList.data.data.data.items}
              staff={staff}
              busy={hide.pending}
              onEdit={(depot) => setDepotForm({ game: filters.game, depot })}
              onToggleHidden={(depot) => void toggleDepot(depot)}
            />
          </>
        )}
        {plain && list.data && list.data.data.data.items.length > 0 && (
          <>
            <CatalogTable
              list={plain}
              items={list.data.data.data.items}
              staff={staff}
              busy={hide.pending}
              onEdit={openEdit}
              onToggleHidden={(item) => void toggleHidden(item)}
            />
            <CatalogCards
              list={plain}
              items={list.data.data.data.items}
              staff={staff}
              busy={hide.pending}
              onEdit={openEdit}
              onToggleHidden={(item) => void toggleHidden(item)}
            />
          </>
        )}
        <Failure error={hide.failure} seconds={hide.seconds} />
        {page && (
          <div className="catalog-pager">
            <span>{t("pagerTotal", { count: page.total })}</span>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={!cursors.length}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                {t("previous")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!page.nextCursor}
                onClick={() => page.nextCursor && setCursors([...cursors, page.nextCursor])}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        )}
        <p className="catalog-muted">{t("hideHelp")}</p>
      </Card>
      {staff && (
        <div className="catalog-mobile-bar">
          {filters.tab === "companies" && (
            <Button type="button" variant="outline" onClick={() => setUploadingLogos(true)}>
              {t("logoUploadShort")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setImporting(true)}>
            {t("importShort")}
          </Button>
          <Button type="button" onClick={openAdd}>
            {t(addLabels[filters.tab])}
          </Button>
        </div>
      )}
      {form && (
        <CatalogForm
          key={`${form.list}/${form.item?.id ?? "new"}`}
          target={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            refresh();
          }}
          onLogoChanged={refresh}
        />
      )}
      {depotForm && (
        <DepotForm
          key={depotForm.depot?.id ?? "new"}
          target={depotForm}
          onClose={() => setDepotForm(null)}
          onSaved={() => {
            setDepotForm(null);
            refresh();
          }}
        />
      )}
      {uploadingLogos && (
        <LogoBulkDialog
          game={filters.game}
          onClose={() => setUploadingLogos(false)}
          onApplied={refresh}
        />
      )}
      {importing && (
        <CatalogImport
          list={filters.tab}
          listLabel={tabLabel}
          onClose={() => setImporting(false)}
          onApplied={refresh}
        />
      )}
    </div>
  );
}
