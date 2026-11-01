import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Button } from "../../shared/ui/primitives.js";
import { State } from "./components.js";
import { useTripQuery } from "./queries.js";
import { CatalogName, DecisionBadge, GameChip, sourceNames } from "./TripTable.js";
import { type DTO, validId } from "./transport.js";
import "./trips-list.css";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Non-modal detail region beside the trip table. The server decides between the summary and
 * private views; this panel renders only what the received view contains.
 */
export function TripPanel({
  tripId,
  review,
  fallback,
  headingRef,
  onClose,
}: {
  tripId: string;
  review: boolean;
  fallback: DTO["TripSummary"] | undefined;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("trips"),
    session = useSession(),
    headingId = useId(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC",
    staff = !!session.self?.capabilities.includes("trips.review");
  const query = useTripQuery(
    `/trips/${tripId}`,
    "EnvelopeTripView",
    validId(tripId) && (!review || staff),
  );
  const view = query.data?.data.data,
    summary = view?.view === "private" ? view.summary : view,
    current = summary ?? fallback,
    // The list row names the heading first so the focused heading does not change on load.
    titled = fallback ?? summary;
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = section.current;
    return () => {
      // Back/Forward, narrowing below the wide layout or an outside selection change can remove
      // the panel while it holds focus. Close/Escape already moved focus to the row link.
      if (!node?.contains(document.activeElement)) return;
      (
        document.getElementById(`trip-link-${tripId}`) ?? document.getElementById("main-content")
      )?.focus();
    };
  }, [tripId]);
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }
  return (
    <section ref={section} className="trips-panel" aria-labelledby={headingId} onKeyDown={keyDown}>
      <header className="trips-panel-header">
        <div className="trips-panel-bar">
          {current && <GameChip game={current.game} />}
          {current && <DecisionBadge decision={current.decision} />}
          <span className="trips-panel-actions">
            <Button asChild variant="outline" size="xs">
              <Link to={`/account/trips/${tripId}`}>{t("openFull")}</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="trips-panel-close"
              aria-label={t("closeDetails")}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </span>
        </div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {titled ? (
            <>
              <CatalogName value={titled.origin} /> → <CatalogName value={titled.destination} />
            </>
          ) : (
            t("details")
          )}
        </h2>
        {current && (
          <p className="trips-panel-meta">
            {current.owner.nickname} · {sourceNames(current, t)} · {t("version")} {current.version}
          </p>
        )}
      </header>
      <div className="trips-panel-body">
        <State query={query} />
        {summary && (
          <>
            <dl className="trips-facts">
              <Fact label={t("actualDistanceDisplay")}>
                {formatQuantity(summary.actualDistanceM, "km", locale)}
              </Fact>
              <Fact label={t("cargo")}>
                <CatalogName value={summary.cargo} />
              </Fact>
              <Fact label={t("outcome")}>
                {t(summary.outcome === "open" ? "outcomeOpen" : summary.outcome)}
              </Fact>
              <Fact label={t("recording")}>
                {t(
                  summary.recording === "partial"
                    ? "partialRecording"
                    : summary.recording === "complete"
                      ? "complete"
                      : "unknownRecording",
                )}
              </Fact>
              {view?.view === "private" && view.effectiveFacts && (
                <>
                  <Fact label={t("cargoMassDisplay")}>
                    {formatQuantity(view.effectiveFacts.cargoMassKg, "t", locale)}
                  </Fact>
                  <Fact label={t("actualCompletedAt")}>
                    {formatUtc(view.effectiveFacts.actualCompletedAt, locale, timezone)}
                  </Fact>
                </>
              )}
              <Fact label={t("reportingAt")}>
                <span>{formatUtc(summary.reportingAt, locale, timezone)}</span>
                <small>
                  {t(summary.reportingBasis ?? "unknown")} · {timezone}
                </small>
              </Fact>
            </dl>
            {view?.view === "private" && !view.effectiveFacts && (
              <p className="trips-panel-note">{t("partial")}</p>
            )}
            <h3>{t("decisions")}</h3>
            {view?.view === "private" ? (
              view.decisions.length ? (
                <ol className="trips-history">
                  {view.decisions.map((decision) => (
                    <li key={decision.id} data-outcome={decision.outcome}>
                      <strong>{t(decision.outcome)}</strong>
                      <span className="trips-panel-meta">
                        {formatUtc(decision.decidedAt, locale, timezone)}
                      </span>
                      {decision.reason && <p>{decision.reason}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="trips-panel-note">{t("noDecisions")}</p>
              )
            ) : (
              <p className="trips-panel-note">{t("historyUnavailable")}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
