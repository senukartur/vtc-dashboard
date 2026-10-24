import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import { PageNav, State, TripSummary } from "./components.js";
import { useTripQuery } from "./queries.js";
import { queryString, tripFilters } from "./transport.js";
import "./trips.css";
export function TripsPage({ review = false }: { review?: boolean }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    [params, setParams] = useSearchParams(),
    staff = !!session.self?.capabilities.includes("trips.review");
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
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("cursor");
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
  return (
    <div className="stack trip-page">
      <header className="trip-heading">
        <div>
          <h1>{t(review ? "review" : "title")}</h1>
          <p>{t("frozen")}</p>
        </div>
        <div className="trip-actions">
          {session.self?.capabilities.includes("trips.submit_own") && (
            <Button asChild>
              <Link to="/account/reports/new">{t("newReport")}</Link>
            </Button>
          )}
          {session.self?.capabilities.includes("trips.submit_own") && (
            <Button asChild variant="outline">
              <Link to="/account/reports">{t("drafts")}</Link>
            </Button>
          )}
          {staff && (
            <>
              <Button asChild variant="outline">
                <Link to="/account/review">{t("review")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/account/review/reconciliation">{t("reconciliation")}</Link>
              </Button>
            </>
          )}
        </div>
      </header>
      {!review && (
        <nav className="trip-actions" aria-label={t("title")}>
          {["mine", "company"].map((s) => (
            <Button
              key={s}
              variant={scope === s ? "default" : "outline"}
              onClick={() => change("scope", s)}
              aria-current={scope === s ? "page" : undefined}
            >
              {t(s)}
            </Button>
          ))}
        </nav>
      )}
      <Card className="stack">
        <div className="trip-grid">
          <div>
            <Label htmlFor="trip-game">{t("game")}</Label>
            <select
              className="input"
              id="trip-game"
              value={filters.game ?? ""}
              onChange={(e) => change("game", e.target.value)}
            >
              <option value="">{t("all")}</option>
              <option value="ets2">ETS2</option>
              <option value="ats">ATS</option>
            </select>
          </div>
          {scope !== "company" && (
            <div>
              <Label htmlFor="trip-decision">{t("decision")}</Label>
              <select
                className="input"
                id="trip-decision"
                value={filters.decision ?? ""}
                onChange={(e) => change("decision", e.target.value)}
              >
                <option value="">{t("all")}</option>
                {["unassessed", "pending_review", "accepted", "rejected"].map((d) => (
                  <option value={d} key={d}>
                    {t(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <State
          query={query}
          refresh={() => {
            setPage({ key: filterKey, cursor: null, cursors: [] });
            if (!cursor) void query.refetch();
          }}
        />
        {query.data && (
          <>
            {!query.data.data.data.items.length && <p>{t("empty")}</p>}
            {query.data.data.data.items.map((trip) => (
              <TripSummary key={trip.id} trip={trip} />
            ))}
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
          </>
        )}
      </Card>
    </div>
  );
}
