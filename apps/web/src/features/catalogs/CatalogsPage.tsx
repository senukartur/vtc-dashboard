import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import {
  type CatalogItem,
  type CatalogList,
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
import { Failure } from "./Feedback.js";
import { type CatalogFilters, catalogTabs, filterParams, parseFilters } from "./model.js";
import { summarySchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";
import "./catalogs.css";

const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;
const tabLabels: Record<CatalogList, string> = {
  dlcs: "tabDlcs",
  regions: "tabRegions",
  cities: "tabCities",
  cargoes: "tabCargoes",
  trailers: "tabTrailers",
};
const addLabels: Record<CatalogList, string> = {
  dlcs: "addDlcs",
  regions: "addRegions",
  cities: "addCities",
  cargoes: "addCargoes",
  trailers: "addTrailers",
};

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
  const filterKey = `${filters.game}/${filters.tab}/${filters.q}/${filters.dlc}/${filters.region}/${filters.hidden}/${locale}`;
  // Cursors belong to one filter set; a changed filter set restarts at the first page.
  const [paging, setPaging] = useState<{ key: string; cursors: string[] }>({
    key: filterKey,
    cursors: [],
  });
  const cursors = paging.key === filterKey ? paging.cursors : [];
  const setCursors = (next: string[]) => setPaging({ key: filterKey, cursors: next });
  const [form, setForm] = useState<FormTarget | null>(null);
  const [importing, setImporting] = useState(false);
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
    `/catalogs/${filters.tab}?${catalogParams({
      game: filters.game,
      search: filters.q || undefined,
      includeHidden: filters.hidden ? "true" : undefined,
      dlc: filters.tab !== "dlcs" ? filters.dlc || undefined : undefined,
      regionId: filters.tab === "cities" ? filters.region || undefined : undefined,
      locale,
      limit: 25,
      cursor,
    })}`,
    listSchema,
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
  const page = list.data?.data.data;
  const counts = summary.data?.data.data.lists;
  const openAdd = () => setForm({ list: filters.tab, game: filters.game, item: null });
  const openEdit = (item: CatalogItem) => setForm({ list: filters.tab, game: filters.game, item });
  const filtered = !!(filters.q || filters.dlc || filters.region);
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
          onValueChange={(game) => update({ game, dlc: "", region: "" })}
        />
        {staff && (
          <div className="catalog-actions">
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
      <div className="catalog-tabs" role="tablist" aria-label={t("title")}>
        {catalogTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className="catalog-tab"
            aria-selected={tab === filters.tab}
            onClick={() => update({ tab, dlc: "", region: "" })}
          >
            {t(tabLabels[tab])}
            {counts && <small>{counts[tab].visible}</small>}
          </button>
        ))}
      </div>
      <Card className="catalog-card">
        <CatalogToolbar filters={filters} tab={filters.tab} onChange={update} />
        {list.isPending && <p role="status">{t("loading")}</p>}
        {list.isError && (
          <div role="alert">
            <p>{t("readError")}</p>
            <Button type="button" variant="outline" onClick={() => void list.refetch()}>
              {t("refresh")}
            </Button>
          </div>
        )}
        {page && page.items.length === 0 && !list.isPending && (
          <p className="catalog-muted">{t(filtered || filters.hidden ? "empty" : "emptyList")}</p>
        )}
        {page && page.items.length > 0 && (
          <>
            <CatalogTable
              list={filters.tab}
              items={page.items}
              staff={staff}
              busy={hide.pending}
              onEdit={openEdit}
              onToggleHidden={(item) => void toggleHidden(item)}
            />
            <CatalogCards
              list={filters.tab}
              items={page.items}
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
