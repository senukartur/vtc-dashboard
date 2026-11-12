import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { isPlainSelfClick } from "../../app/Navigation.js";
import { useSession } from "../../app/Session.js";
import { formatDecimal, formatQuantity } from "../../shared/formatting.js";
import { Button } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { DraftList, useManualDrafts } from "../manual-reports/Drafts.js";
import { PageNav, State } from "./components.js";
import { useWideLayout } from "./layout.js";
import { tripListFilters, tripPeriodBounds } from "./list-model.js";
import { useTripQuery } from "./queries.js";
import { TripListFilters } from "./TripListFilters.js";
import { TripPanel } from "./TripPanel.js";
import { TripTable } from "./TripTable.js";
import {
  filterSearch,
  queryString,
  rejectedCursor,
  selectedTrip,
  selectionSearch,
} from "./transport.js";
import { useSearchDraft } from "./useSearchDraft.js";
import "./trips.css";
import "./trips-list.css";

const firstPage = (key: string) => ({ key, cursor: null, previous: [] });

export function TripsPage() {
  const { t, i18n } = useTranslation("trips");
  const session = useSession();
  const location = useLocation();
  const wide = useWideLayout();
  const [params, setParams] = useSearchParams();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const savedTimezone = session.self?.preferences.displayTimezone;
  const timezone = savedTimezone ?? "UTC";
  const submit = !!session.self?.capabilities.includes("trips.submit_own");
  const viewDrafts = submit && params.get("tab") === "drafts";
  const drafts = useManualDrafts(submit);
  const editingCount = drafts.data?.data.data.editingCount;
  const { period, ...effective } = tripListFilters(params);
  const { scope, ownerId, q, order } = effective;
  const showOwnLifetime =
    !viewDrafts &&
    scope === "mine" &&
    !!session.self?.capabilities.includes("trips.read_own_private");

  const bounds =
    period && savedTimezone ? tripPeriodBounds(period, new Date(), savedTimezone) : undefined;
  const periodUnavailable = !!period && !bounds;

  const filterKey = queryString({ ...effective, ...bounds, locale });
  const [page, setPage] = useState<{
    key: string;
    cursor: string | null;
    previous: (string | null)[];
  }>(() => firstPage(filterKey));
  const { cursor, previous } = page.key === filterKey ? page : firstPage(filterKey);
  if (page.key !== filterKey) setPage(firstPage(filterKey));
  const query = useTripQuery(
    `/trips?${queryString({ ...effective, ...bounds, locale, limit: 25, cursor })}`,
    "EnvelopeListTripSummary",
    !viewDrafts,
  );
  const ownSummary = useTripQuery(
    "/me/trip-status-summary",
    "EnvelopeOwnTripStatusSummary",
    showOwnLifetime,
  );
  const lifetime = ownSummary.data?.data.data.lifetimeTotals;
  const list = query.data?.data.data;
  const total = list?.total;
  // A rejected cursor restarts the same effective list without rendering a page error.
  if (rejectedCursor(cursor, query.error)) setPage(firstPage(filterKey));

  // The side panel exists only on wide layouts; narrow layouts ignore `?trip=` entirely.
  const selected = !viewDrafts && wide ? selectedTrip(params) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  // Focus intent from a plain row click; Back/Forward and deep links leave focus alone.
  const focusPanel = useRef(false);
  useEffect(() => {
    if (!selected || !focusPanel.current) return;
    focusPanel.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [selected]);

  // Use the current URL so rapid successive updates keep each other's filters.
  function change(key: string, value: string) {
    const next = filterSearch(window.location.search, key, value);
    if (key === "scope") {
      next.delete("tab");
      if (scope !== value) {
        next.delete("decision");
        next.delete("ownerId");
      }
    }
    setParams(next);
  }
  function changeTab(value: string) {
    if (value === "drafts") setParams(filterSearch(window.location.search, "tab", value));
    else change("scope", value);
  }
  const { draft, setDraft } = useSearchDraft(q, (value) => change("q", value));
  const searchInput = useRef<HTMLInputElement>(null);
  function reset() {
    const next = new URLSearchParams(window.location.search);
    for (const key of [
      "game",
      "decision",
      "source",
      "period",
      "order",
      "ownerId",
      "q",
      "cursor",
      "trip",
    ]) {
      next.delete(key);
    }
    setDraft("");
    searchInput.current?.focus();
    setParams(next);
  }
  function select(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (!wide || !isPlainSelfClick(event)) return;
    if (id === selected) {
      event.preventDefault();
      heading.current?.focus({ preventScroll: true });
      return;
    }
    focusPanel.current = true;
  }
  function close(id: string) {
    // The row link stays rendered while the panel goes, so focus can move before navigation.
    (
      document.getElementById(`trip-link-${id}`) ?? document.getElementById("main-content")
    )?.focus();
    setParams(selectionSearch(new URLSearchParams(window.location.search), null));
  }

  const knownTotal = total !== undefined ? formatDecimal(String(total), locale) : null;
  const matches =
    knownTotal !== null
      ? t("matches", { total: knownTotal })
      : list || query.isError
        ? t("matchesUnavailable")
        : "";
  const driver = list?.items.find((trip) => trip.owner.id === ownerId)?.owner.nickname;
  const body = (
    <div className="trips-layout" data-panel={selected ? "open" : undefined}>
      <div className="trips-list-area">
        <State
          query={query}
          refresh={() => {
            setPage(firstPage(filterKey));
            if (!cursor) void query.refetch();
          }}
        />
        <TripTable
          items={list?.items}
          selectedId={selected}
          showOwner={scope === "company"}
          timezone={timezone}
          order={order}
          onSort={() =>
            change("order", order === "completion_desc" ? "completion_asc" : "completion_desc")
          }
          linkFor={(id) =>
            wide
              ? { pathname: location.pathname, search: selectionSearch(params, id) }
              : `/account/trips/${id}`
          }
          onLinkClick={select}
          footer={
            list && (
              <PageNav
                next={list.nextCursor}
                hasPrevious={previous.length > 0}
                onNext={(next) =>
                  setPage({ key: filterKey, previous: [...previous, cursor], cursor: next })
                }
                onPrevious={() =>
                  setPage({
                    key: filterKey,
                    cursor: previous.at(-1) ?? null,
                    previous: previous.slice(0, -1),
                  })
                }
              />
            )
          }
        />
      </div>
      {selected && (
        <TripPanel
          key={selected}
          tripId={selected}
          fallback={list?.items.find((trip) => trip.id === selected)}
          headingRef={heading}
          onClose={() => close(selected)}
        />
      )}
    </div>
  );

  return (
    <div className="stack trip-page">
      <header className="trip-heading trips-header">
        <div>
          <h1>{t("title")}</h1>
          {showOwnLifetime && !ownSummary.isPending && (
            <p className="trips-note">
              {lifetime
                ? t("ownLifetime", {
                    trips: formatDecimal(String(lifetime.acceptedTrips), locale),
                    distance: formatQuantity(lifetime.actualDistanceM, "km", locale),
                  })
                : t("ownLifetimeUnavailable")}
            </p>
          )}
        </div>
        {submit && (
          <Button asChild>
            <Link to="/account/reports/new">{t("newReport")}</Link>
          </Button>
        )}
      </header>
      <Tabs
        className="trips-workspace"
        value={viewDrafts ? "drafts" : scope}
        onValueChange={changeTab}
        activationMode="manual"
      >
        <div className="trips-scope">
          <TabsList aria-label={t("scopeLabel")}>
            {(["mine", "company"] as const).map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(tab)}
                {tab === scope && knownTotal !== null && (
                  <span className="trips-tab-count" aria-hidden="true">
                    {knownTotal}
                  </span>
                )}
              </TabsTrigger>
            ))}
            {submit && (
              <TabsTrigger
                value="drafts"
                aria-label={
                  editingCount === undefined
                    ? undefined
                    : t("draftsWithCount", { total: formatDecimal(String(editingCount), locale) })
                }
              >
                {t("draftsTab")}
                {editingCount !== undefined && (
                  <span className="trips-tab-count" aria-hidden="true">
                    {formatDecimal(String(editingCount), locale)}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        {!viewDrafts && (
          <>
            <TripListFilters
              filters={{ ...effective, period }}
              effectivePeriod={periodUnavailable ? undefined : period}
              search={draft}
              searchRef={searchInput}
              onSearch={setDraft}
              onChange={change}
              onReset={reset}
              matches={matches}
            />
            {periodUnavailable && (
              <div className="trips-period-note" role="status">
                <span>{t("periodUnavailable")}</span>
                <Link to="/account/preferences">{t("openPreferences")}</Link>
              </div>
            )}
            <div className="trips-list-meta">
              {ownerId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("clearDriver")}
                  onClick={() => {
                    searchInput.current?.focus();
                    change("ownerId", "");
                  }}
                >
                  {driver ?? t("selectedDriver")} <span aria-hidden="true">×</span>
                </Button>
              )}
              <small className="trips-timezone">{t("timesIn", { timezone })}</small>
            </div>
            <TabsContent value="mine">{body}</TabsContent>
            <TabsContent value="company">{body}</TabsContent>
          </>
        )}
        {viewDrafts && (
          <TabsContent value="drafts">
            <DraftList first={drafts} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
