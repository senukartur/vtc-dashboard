import { type MouseEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isPlainSelfClick } from "../../app/Navigation.js";
import { useSession } from "../../app/Session.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Label, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { failureKey, State } from "../trips/components.js";
import { useWideLayout } from "../trips/layout.js";
import { useTripQuery } from "../trips/queries.js";
import { selectionSearch, tripSourceLabels, tripSources } from "../trips/transport.js";
import { DecisionPanel } from "./DecisionPanel.js";
import { DispatchDuplicates } from "./DispatchDuplicates.js";
import { DispatchQueueTable } from "./DispatchQueueTable.js";
import { DriverFilter } from "./DriverFilter.js";
import {
  type DispatchTab,
  dispatchListQuery,
  dispatchParams,
  dispatchSearch,
  isReviewReasonCode,
  queueAge,
  reviewReasons,
} from "./dispatch-model.js";
import { ReconciliationHistory } from "./reconciliation-parts.js";
import { pageSize, selfReviewCode } from "./review-model.js";
import "../trips/trips.css";
import "../trips/trips-list.css";
import "./review.css";

export function DispatchReviewPage({
  reconciliationAlias = false,
}: {
  reconciliationAlias?: boolean;
}) {
  const { t, i18n } = useTranslation("trips");
  const session = useSession();
  const memberId = session.self?.member.id;
  const timezone = session.self?.preferences.displayTimezone ?? "UTC";
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWideLayout();
  const [search, setSearch] = useSearchParams();
  const raw = dispatchParams(search);
  const params = reconciliationAlias ? { ...raw, tab: "duplicates" as const } : raw;
  const duplicates = params.tab === "duplicates";
  const resolved = params.tab === "resolved";
  const pages = useCursorPages(queryString(dispatchListQuery(params, null, locale)));
  const summary = useTripQuery("/trips/review-summary", "TripStage3ReviewSummaryEnvelope");
  const query = useTripQuery(
    `/trips?${queryString(dispatchListQuery(params, pages.cursor, locale))}`,
    "TripStage3ReviewListEnvelope",
    !duplicates,
    false,
    true,
  );
  pages.recover(query.error);

  const data = query.data?.data.data;
  const rows = data?.items.filter(
    (item) => item.state === (resolved ? "resolved" : "waiting") && item.trip.owner.id !== memberId,
  );
  const totals = summary.data?.data.data;
  const selected = wide && !duplicates ? params.trip : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const focusPanel = useRef(false);
  useEffect(() => {
    if (!selected || !focusPanel.current) return;
    focusPanel.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [selected]);
  const backParams = new URLSearchParams(search);
  if (reconciliationAlias) backParams.set("tab", "duplicates");
  const back = dispatchSearch(backParams);

  function change(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(window.location.search);
    update(next);
    next.delete("cursor");
    pages.restart();
    setSearch(next);
  }
  function filter(name: string, value: string) {
    change((next) => {
      if (value) next.set(name, value);
      else next.delete(name);
    });
  }
  function tab(value: DispatchTab) {
    if (value === params.tab) return;
    const update = (next: URLSearchParams) => {
      if (value === "queue") next.delete("tab");
      else next.set("tab", value);
      next.delete("trip");
      next.delete("decision");
    };
    if (reconciliationAlias) {
      const next = new URLSearchParams(window.location.search);
      update(next);
      navigate(`/account/review${dispatchSearch(next)}`);
    } else change(update);
  }
  function select(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (!wide || !isPlainSelfClick(event)) return;
    if (id === selected) {
      event.preventDefault();
      heading.current?.focus({ preventScroll: true });
    } else focusPanel.current = true;
  }
  function close(id: string) {
    (
      document.getElementById(`trip-link-${id}`) ??
      document.getElementById("review-queue-table") ??
      document.getElementById("dispatch-list") ??
      document.getElementById("main-content")
    )?.focus();
    const next = new URLSearchParams(window.location.search);
    next.delete("trip");
    setSearch(next);
  }

  const reasons = Array.from(
    new Set([
      ...reviewReasons,
      ...(rows?.flatMap((row) => row.reasonCodes) ?? []),
      params.reasonCode,
    ]),
  ).filter(isReviewReasonCode);
  const number = new Intl.NumberFormat(locale);
  const filtered = !!(params.game || params.ownerId || params.reasonCode || params.source);
  return (
    <div className="stack trip-page review-queue dispatch-review">
      <header className="review-queue-header">
        <h1>{t("review")}</h1>
        <State query={summary} />
        {totals && (
          <div className="review-queue-totals">
            <strong>
              {t("dispatchWaitingCount", { total: number.format(totals.waitingCount) })}
            </strong>
            <span className="review-muted">
              {totals.oldestAgeSeconds === null
                ? t("queueNoneWaiting")
                : t("queueOldest", { age: queueAge(totals.oldestAgeSeconds, locale) })}
            </span>
          </div>
        )}
      </header>
      <div className="review-toolbar">
        <SegmentedControl
          aria-label={t("queueTabs")}
          className="review-tabs"
          size="sm"
          value={params.tab}
          onValueChange={tab}
          options={[
            { value: "queue", label: t("dispatchQueue") },
            {
              value: "duplicates",
              label: totals
                ? t("dispatchDuplicateCount", { total: number.format(totals.duplicateCount) })
                : t("dispatchDuplicates"),
            },
            { value: "resolved", label: t("dispatchResolved") },
          ]}
        />
        <fieldset className="review-filters" aria-label={t("filters")}>
          <div className="review-filter">
            <Label htmlFor="dispatch-game" className="visually-hidden">
              {t("game")}
            </Label>
            <Select
              id="dispatch-game"
              value={params.game ?? ""}
              onChange={(event) => filter("game", event.target.value)}
            >
              <option value="">{t("allGames")}</option>
              <option value="ets2">ETS2</option>
              <option value="ats">ATS</option>
            </Select>
          </div>
          {!duplicates && (
            <>
              <div className="review-filter">
                <Label htmlFor="dispatch-reason" className="visually-hidden">
                  {t("dispatchReason")}
                </Label>
                <Select
                  id="dispatch-reason"
                  value={params.reasonCode ?? ""}
                  onChange={(event) => filter("reasonCode", event.target.value)}
                >
                  <option value="">{t("dispatchAllReasons")}</option>
                  {reasons.map((code) => (
                    <option key={code} value={code}>
                      {t(`code_${code}`, { defaultValue: code })}
                    </option>
                  ))}
                </Select>
              </div>
              <DriverFilter
                ownerId={params.ownerId}
                memberId={memberId}
                change={(id) => filter("ownerId", id)}
              />
              <div className="review-filter">
                <Label htmlFor="dispatch-source" className="visually-hidden">
                  {t("sourceFilter")}
                </Label>
                <Select
                  id="dispatch-source"
                  value={params.source ?? ""}
                  onChange={(event) => filter("source", event.target.value)}
                >
                  <option value="">{t("anySource")}</option>
                  {tripSources.map((source) => (
                    <option key={source} value={source}>
                      {t(tripSourceLabels[source])}
                    </option>
                  ))}
                </Select>
              </div>
              {!resolved && (
                <div className="review-filter">
                  <Label htmlFor="dispatch-order" className="visually-hidden">
                    {t("order")}
                  </Label>
                  <Select
                    id="dispatch-order"
                    value={params.order}
                    onChange={(event) =>
                      filter("order", event.target.value === "desc" ? "desc" : "")
                    }
                  >
                    <option value="asc">{t("oldestFirst")}</option>
                    <option value="desc">{t("newestFirst")}</option>
                  </Select>
                </div>
              )}
            </>
          )}
        </fieldset>
        <small className="review-timezone">{t("timesIn", { timezone })}</small>
      </div>
      {duplicates ? (
        <>
          <DispatchDuplicates
            game={params.game}
            status={params.duplicateStatus}
            memberId={memberId}
            timezone={timezone}
            changeStatus={(status) => filter("duplicates", status === "dismissed" ? status : "")}
            back={back}
          />
          {reconciliationAlias && raw.trip && (
            <DispatchReconciliationHistory tripId={raw.trip} memberId={memberId} />
          )}
        </>
      ) : (
        <div className="review-layout" data-panel={selected ? "open" : undefined}>
          <div id="dispatch-list" tabIndex={-1} className="review-list-area">
            <DispatchQueueTable
              rows={rows}
              resolved={resolved}
              selected={selected}
              computedAt={totals?.computedAt}
              timezone={timezone}
              linkFor={(id) =>
                wide
                  ? { pathname: location.pathname, search: selectionSearch(search, id) }
                  : `/account/review/${id}${back}`
              }
              onLinkClick={select}
              state={{
                status: query.isError ? "error" : data ? "ready" : "loading",
                busy: query.isPlaceholderData,
                error: t(failureKey(query.error)),
                onRetry: () => {
                  pages.restart();
                  if (!pages.cursor) void query.refetch();
                },
                empty: { message: t(resolved ? "dispatchNoResolved" : "emptyAwaiting") },
                ...(filtered
                  ? {
                      filtered: {
                        message: t("emptyFiltered"),
                        onReset: () => {
                          document.getElementById("dispatch-game")?.focus();
                          change((next) => {
                            for (const name of ["game", "source", "reasonCode", "ownerId", "order"])
                              next.delete(name);
                          });
                        },
                      },
                    }
                  : {}),
                pagination: { pages, nextCursor: data?.nextCursor, pageSize, total: data?.total },
              }}
            />
          </div>
          {selected && (
            <DecisionPanel
              key={selected}
              tripId={selected}
              staged
              variant="side"
              fallback={rows?.find(({ trip }) => trip.id === selected)?.trip}
              headingRef={heading}
              onClose={() => close(selected)}
              fullHref={`/account/review/${selected}${back}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DispatchReconciliationHistory({
  tripId,
  memberId,
}: {
  tripId: string;
  memberId: string | undefined;
}) {
  const { t } = useTranslation("trips");
  const query = useTripQuery(`/trips/${tripId}/review?view=stage3`, "TripStage3ReviewEnvelope");
  const review = query.data?.data.data;
  return review &&
    review.summary.owner.id !== memberId &&
    !review.blockedReasonCodes.includes(selfReviewCode) ? (
    <ReconciliationHistory tripId={tripId} />
  ) : review ? (
    <p>{t("selfReview")}</p>
  ) : (
    <State query={query} />
  );
}
