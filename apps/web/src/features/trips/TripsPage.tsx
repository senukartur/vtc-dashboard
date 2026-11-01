import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { isPlainSelfClick } from "../../app/Navigation.js";
import { useSession } from "../../app/Session.js";
import { Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { PageNav, State } from "./components.js";
import { useWideLayout } from "./layout.js";
import { useTripQuery } from "./queries.js";
import { TripPanel } from "./TripPanel.js";
import { TripTable } from "./TripTable.js";
import { queryString, selectedTrip, selectionSearch, tripFilters } from "./transport.js";
import "./trips.css";
import "./trips-list.css";
export function TripsPage({ review = false }: { review?: boolean }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    location = useLocation(),
    wide = useWideLayout(),
    [params, setParams] = useSearchParams(),
    staff = !!session.self?.capabilities.includes("trips.review"),
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  const filters = tripFilters(params, staff),
    scope = review ? "review" : filters.scope;
  const effective = {
    ...filters,
    scope,
    decision: scope === "company" ? undefined : filters.decision,
  };
  const filterKey = queryString(effective);
  const [page, setPage] = useState<{ key: string; cursor: string | null; cursors: string[] }>({
    key: filterKey,
    cursor: null,
    cursors: [],
  });
  const { cursor, cursors } = page.key === filterKey ? page : { cursor: null, cursors: [] };
  useEffect(() => setPage({ key: filterKey, cursor: null, cursors: [] }), [filterKey]);
  const query = useTripQuery(
    `/trips?${queryString({ ...effective, limit: 25, cursor })}`,
    "EnvelopeListTripSummary",
    !review || staff,
  );
  // The side panel exists only on wide layouts; narrow layouts ignore `?trip=` entirely.
  const selected = wide ? selectedTrip(params) : null,
    heading = useRef<HTMLHeadingElement>(null),
    // Focus intent from a plain row click; Back/Forward and deep links leave focus alone.
    focusPanel = useRef(false);
  useEffect(() => {
    if (!selected || !focusPanel.current) return;
    focusPanel.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [selected]);
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("cursor");
      next.delete("trip");
      return next;
    });
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
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("trip");
      return next;
    });
  }
  if (review && !staff)
    return (
      <Card>
        <h1>{t("review")}</h1>
        <p>{t("forbidden")}</p>
      </Card>
    );
  const items = query.data?.data.data.items;
  const toolbar = (
    <fieldset className="trips-toolbar" aria-label={t("filters")}>
      <span className="trips-filter">
        <Label htmlFor="trip-game" className="visually-hidden">
          {t("game")}
        </Label>
        <Select
          id="trip-game"
          value={filters.game ?? ""}
          onChange={(e) => change("game", e.target.value)}
        >
          <option value="">{t("allGames")}</option>
          <option value="ets2">ETS2</option>
          <option value="ats">ATS</option>
        </Select>
      </span>
      {scope !== "company" && (
        <span className="trips-filter">
          <Label htmlFor="trip-decision" className="visually-hidden">
            {t("decision")}
          </Label>
          <Select
            id="trip-decision"
            value={filters.decision ?? ""}
            onChange={(e) => change("decision", e.target.value)}
          >
            <option value="">{t("anyDecision")}</option>
            {["unassessed", "pending_review", "accepted", "rejected"].map((d) => (
              <option value={d} key={d}>
                {t(d)}
              </option>
            ))}
          </Select>
        </span>
      )}
      <small className="trips-timezone">{t("timesIn", { timezone })}</small>
    </fieldset>
  );
  const body = (
    <div className="trips-layout" data-panel={selected ? "open" : undefined}>
      <div className="trips-list-area">
        <State
          query={query}
          refresh={() => {
            setPage({ key: filterKey, cursor: null, cursors: [] });
            if (!cursor) void query.refetch();
          }}
        />
        {query.data && (
          <TripTable
            items={query.data.data.data.items}
            selectedId={selected}
            showOwner={scope !== "mine"}
            timezone={timezone}
            linkFor={(id) =>
              wide
                ? { pathname: location.pathname, search: selectionSearch(params, id) }
                : `/account/trips/${id}`
            }
            onLinkClick={select}
            footer={
              <PageNav
                next={query.data.data.data.nextCursor}
                hasPrevious={cursors.length > 0}
                onNext={(next) => {
                  setPage({ key: filterKey, cursors: [...cursors, cursor ?? ""], cursor: next });
                }}
                onPrevious={() => {
                  setPage({
                    key: filterKey,
                    cursor: cursors.at(-1) || null,
                    cursors: cursors.slice(0, -1),
                  });
                }}
              />
            }
          />
        )}
      </div>
      {selected && (
        <TripPanel
          key={selected}
          tripId={selected}
          review={review}
          fallback={items?.find((trip) => trip.id === selected)}
          headingRef={heading}
          onClose={() => close(selected)}
        />
      )}
    </div>
  );
  const submit = session.self?.capabilities.includes("trips.submit_own");
  return (
    <div className="stack trip-page">
      <header className="trip-heading trips-header">
        <div>
          <h1>{t(review ? "review" : "title")}</h1>
          <p className="trips-note">{t("frozen")}</p>
        </div>
        {submit && (
          <div className="trip-actions">
            <Button asChild variant="outline">
              <Link to="/account/reports">{t("drafts")}</Link>
            </Button>
            <Button asChild>
              <Link to="/account/reports/new">{t("newReport")}</Link>
            </Button>
          </div>
        )}
      </header>
      {review ? (
        <div className="trips-workspace">
          {toolbar}
          {body}
        </div>
      ) : (
        <Tabs
          className="trips-workspace"
          value={scope}
          onValueChange={(value) => change("scope", value)}
          activationMode="manual"
        >
          <TabsList aria-label={t("scopeLabel")}>
            <TabsTrigger value="mine">{t("mine")}</TabsTrigger>
            <TabsTrigger value="company">{t("company")}</TabsTrigger>
          </TabsList>
          {toolbar}
          <TabsContent value="mine">{body}</TabsContent>
          <TabsContent value="company">{body}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
