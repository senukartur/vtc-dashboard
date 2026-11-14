import { type MouseEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";
import { isPlainSelfClick } from "../../app/Navigation.js";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { failureKey } from "../trips/components.js";
import { useWideLayout } from "../trips/layout.js";
import { useTripQuery } from "../trips/queries.js";
import { selectionSearch, tripSourceLabels, tripSources } from "../trips/transport.js";
import { DecisionPanel } from "./DecisionPanel.js";
import { DispatchReviewPage } from "./DispatchReviewPage.js";
import { ReviewAccessState } from "./ReviewAccessState.js";
import { ReviewQueueTable } from "./ReviewQueueTable.js";
import {
  decisions,
  listQuery,
  type QueueTab,
  queueHeaderState,
  queueParams,
  queueSearch,
} from "./review-model.js";
import "../trips/trips.css";
import "../trips/trips-list.css";
import "./review.css";

function queueAge(seconds: number, locale: string) {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (seconds >= 3600) return formatter.format(-Math.floor(seconds / 3600), "hour");
  if (seconds >= 60) return formatter.format(-Math.floor(seconds / 60), "minute");
  return formatter.format(-seconds, "second");
}

export function ReviewQueuePage() {
  const { t } = useTranslation("trips");
  const session = useSession();
  const summary = useWorkspaceSummary();
  if (!session.self?.capabilities.includes("trips.review"))
    return (
      <Card>
        <h1>{t("review")}</h1>
        <p>{t("forbidden")}</p>
      </Card>
    );
  if (summary.dispatchMode === "stage3") return <DispatchReviewPage />;
  if (summary.dispatchMode === "legacy") return <LegacyReviewQueuePage />;
  return <ReviewAccessState summary={summary} />;
}

/**
 * Dispatch review queue (VTC-059): Awaiting (held, oldest first) and Decided tabs, game, source
 * (VTC-077), decision and order filters, cursor pages and, from 1200px, a decision panel beside the
 * queue selected by `?trip=`. Narrower screens open the full review page instead. A filter change
 * restarts paging and closes the panel; switching tabs keeps the game and source.
 */
function LegacyReviewQueuePage() {
  const { t, i18n } = useTranslation("trips"),
    session = useSession(),
    location = useLocation(),
    wide = useWideLayout(),
    [search, setSearch] = useSearchParams(),
    timezone = session.self?.preferences.displayTimezone ?? "UTC",
    params = queueParams(search),
    listLocale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    pages = useCursorPages(queryString(listQuery(params, null, listLocale)));
  const query = useTripQuery(
    `/trips?${queryString(listQuery(params, pages.cursor, listLocale))}`,
    "EnvelopeListTripSummary",
    true,
    false,
    true,
  );
  const summary = useWorkspaceSummary();
  const locale = i18n.resolvedLanguage ?? "ru";
  // A cursor the server no longer accepts restarts at the first page of the same filters. The
  // reset happens during render, so the rejected page never shows its error.
  pages.recover(query.error);
  const selected = wide ? params.trip : null,
    heading = useRef<HTMLHeadingElement>(null),
    // Focus intent from a plain row click; Back/Forward and deep links leave focus alone.
    focusPanel = useRef(false);
  useEffect(() => {
    if (!selected || !focusPanel.current) return;
    focusPanel.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [selected]);
  // Router location updates run in a transition, so the hook's search params can trail the URL
  // when two changes follow each other quickly; every update starts from the committed URL.
  const current = () => new URLSearchParams(window.location.search);
  function change(update: (next: URLSearchParams) => void) {
    const next = current();
    update(next);
    next.delete("cursor");
    next.delete("trip");
    setSearch(next);
  }
  function filter(key: string, value: string) {
    change((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  }
  function tab(value: QueueTab) {
    if (value === queueParams(current()).tab) return;
    change((next) => {
      if (value === "decided") next.set("tab", "decided");
      else next.delete("tab");
      next.delete("decision");
      next.delete("order");
    });
  }
  function reset() {
    change((next) => {
      for (const key of ["game", "source", "decision", "order"]) next.delete(key);
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
    // A trip that left this page (for example after a decision) hands focus to the table.
    (
      document.getElementById(`trip-link-${id}`) ??
      document.getElementById("review-queue-table") ??
      document.getElementById("main-content")
    )?.focus();
    const next = current();
    next.delete("trip");
    setSearch(next);
  }
  const list = query.data?.data.data,
    items = list?.items,
    stale = query.isPlaceholderData,
    back = queueSearch(search),
    filtered = !!params.game || !!params.source || !!params.decision || search.has("order"),
    // Own trips on the awaiting page are listed but never counted; the header says so.
    header = queueHeaderState(
      summary.data?.reviewQueue,
      summary.isPending,
      params.tab === "awaiting" && !stale ? items : undefined,
      session.self?.member.id,
    );
  return (
    <div className="stack trip-page review-queue">
      <header className="review-queue-header">
        <h1>{t("review")}</h1>
        <p className="review-muted">{t("queueIntro")}</p>
        {header.kind === "ready" ? (
          <div className="review-queue-totals">
            <strong>
              {t("queueOverall", { total: new Intl.NumberFormat(locale).format(header.count) })}
            </strong>
            <span className="review-muted">
              {header.oldestAgeSeconds === null
                ? t("queueNoneWaiting")
                : t("queueOldest", { age: queueAge(header.oldestAgeSeconds, locale) })}
            </span>
            {header.ownExcluded && (
              <span className="review-muted review-own-excluded">{t("queueOwnExcluded")}</span>
            )}
          </div>
        ) : header.kind === "unavailable" ? (
          <p className="review-muted">{t("queueTotalsUnavailable")}</p>
        ) : null}
      </header>
      <div className="review-toolbar">
        <SegmentedControl
          aria-label={t("queueTabs")}
          className="review-tabs"
          size="sm"
          value={params.tab}
          onValueChange={tab}
          options={[
            { value: "awaiting", label: t("awaiting") },
            { value: "decided", label: t("decidedTab") },
          ]}
        />
        <fieldset className="review-filters" aria-label={t("filters")}>
          <span className="review-filter">
            <Label htmlFor="review-game" className="visually-hidden">
              {t("game")}
            </Label>
            <Select
              id="review-game"
              value={params.game ?? ""}
              onChange={(e) => filter("game", e.target.value)}
            >
              <option value="">{t("allGames")}</option>
              <option value="ets2">ETS2</option>
              <option value="ats">ATS</option>
            </Select>
          </span>
          <span className="review-filter">
            <Label htmlFor="review-source" className="visually-hidden">
              {t("sourceFilter")}
            </Label>
            <Select
              id="review-source"
              value={params.source ?? ""}
              onChange={(e) => filter("source", e.target.value)}
            >
              <option value="">{t("anySource")}</option>
              {tripSources.map((source) => (
                <option value={source} key={source}>
                  {t(tripSourceLabels[source])}
                </option>
              ))}
            </Select>
          </span>
          {params.tab === "decided" && (
            <span className="review-filter">
              <Label htmlFor="review-decision" className="visually-hidden">
                {t("decision")}
              </Label>
              <Select
                id="review-decision"
                value={params.decision ?? ""}
                onChange={(e) => filter("decision", e.target.value)}
              >
                <option value="">{t("anyDecision")}</option>
                {decisions.map((d) => (
                  <option value={d} key={d}>
                    {t(d)}
                  </option>
                ))}
              </Select>
            </span>
          )}
          <span className="review-filter">
            <Label htmlFor="review-order" className="visually-hidden">
              {t("order")}
            </Label>
            <Select
              id="review-order"
              value={params.order}
              onChange={(e) => filter("order", e.target.value)}
            >
              <option value="asc">{t("oldestFirst")}</option>
              <option value="desc">{t("newestFirst")}</option>
            </Select>
          </span>
        </fieldset>
        <small className="review-timezone">{t("timesIn", { timezone })}</small>
      </div>
      <div className="review-layout" data-panel={selected ? "open" : undefined}>
        <div className="review-list-area">
          <ReviewQueueTable
            items={items}
            selectedId={selected}
            memberId={session.self?.member.id}
            timezone={timezone}
            linkFor={(id) =>
              wide
                ? { pathname: location.pathname, search: selectionSearch(search, id) }
                : `/account/review/${id}${back}`
            }
            onLinkClick={select}
            state={{
              status: query.isError ? "error" : list ? "ready" : "loading",
              busy: stale,
              error: t(failureKey(query.error)),
              onRetry: () => {
                pages.restart();
                if (!pages.cursor) void query.refetch();
              },
              empty:
                params.tab === "awaiting" && !filtered && !pages.cursor
                  ? {
                      message: t("emptyAwaiting"),
                      action: (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            // This button unmounts with the empty state; keep focus on the chosen tab.
                            const label = t("decidedTab");
                            Array.from(
                              document.querySelectorAll<HTMLElement>(".review-tabs button"),
                            )
                              .find((button) => button.textContent === label)
                              ?.focus();
                            tab("decided");
                          }}
                        >
                          {t("showDecided")}
                        </Button>
                      ),
                    }
                  : { message: t("emptyFiltered") },
              ...(filtered
                ? {
                    filtered: {
                      message: t("emptyFiltered"),
                      onReset: () => {
                        // This button unmounts with the empty state; keep focus on the first filter.
                        document.getElementById("review-game")?.focus();
                        reset();
                      },
                    },
                  }
                : {}),
              pagination: { pages, nextCursor: list?.nextCursor, pageSize: 25 },
              footer: list && (
                <small className="review-muted review-list-footer">{t("queueNote")}</small>
              ),
            }}
          />
        </div>
        {selected && (
          <DecisionPanel
            key={selected}
            tripId={selected}
            variant="side"
            fallback={items?.find((trip) => trip.id === selected)}
            headingRef={heading}
            onClose={() => close(selected)}
            fullHref={`/account/review/${selected}${back}`}
          />
        )}
      </div>
    </div>
  );
}
