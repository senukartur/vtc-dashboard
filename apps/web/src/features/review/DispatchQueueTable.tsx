import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Table } from "../../shared/ui/primitives.js";
import { CatalogName, GameChip } from "../trips/TripTable.js";
import type { DTO } from "../trips/transport.js";
import { CodeLabel, DispatchDecisionBadge } from "./decision-parts.js";
import { queueAge } from "./dispatch-model.js";

export function ReviewReasonList({ codes }: { codes: string[] }) {
  const { t } = useTranslation("trips");
  if (!codes.length) return t("unknown");
  return (
    <span className="review-break">
      {codes.map((code, index) => (
        <span key={code}>
          {index > 0 && " · "}
          <CodeLabel code={code} />
        </span>
      ))}
    </span>
  );
}

export function DispatchQueueTable({
  rows,
  resolved,
  selected,
  computedAt,
  timezone,
  linkFor,
  onLinkClick,
}: {
  rows: DTO["TripStage3ReviewItem"][];
  resolved: boolean;
  selected: string | null;
  computedAt: string | undefined;
  timezone: string;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const { t, i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const now = computedAt ? Date.parse(computedAt) : Date.now();
  return (
    <Table id="review-queue-table" className="review-table dispatch-table" tabIndex={-1}>
      <caption className="visually-hidden">
        {t(resolved ? "dispatchResolved" : "queueLabel")}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="dispatch-col-age">
            {t(resolved ? "dispatchDecisionTime" : "dispatchWaitAge")}
          </th>
          <th scope="col" className="dispatch-col-driver">
            {t("owner")}
          </th>
          <th scope="col" className="dispatch-col-route">
            {t("route")}
          </th>
          <th scope="col" className="dispatch-col-game">
            {t("game")}
          </th>
          <th scope="col" className="dispatch-col-distance">
            {t("dispatchDistance")}
          </th>
          <th scope="col" className="dispatch-col-reason">
            {t("dispatchReason")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => {
          const { state, trip, reasonCodes } = item;
          const timestamp = state === "resolved" ? item.decidedAt : item.queuedAt;
          const age = Math.floor((now - Date.parse(timestamp)) / 1000);
          const time = formatUtc(timestamp, locale, timezone);
          const current = selected === trip.id;
          return (
            <tr key={trip.id} className="review-row" data-selected={current ? "true" : undefined}>
              <td className="dispatch-age review-muted">
                <time dateTime={timestamp} title={time}>
                  {state === "waiting" && Number.isFinite(age)
                    ? queueAge(Math.max(age, 0), locale)
                    : time}
                </time>
              </td>
              <td className="review-driver">
                <span className="review-break">{trip.owner.nickname}</span>
              </td>
              <td className="review-route">
                <Link
                  id={`trip-link-${trip.id}`}
                  className="review-link review-break"
                  to={linkFor(trip.id)}
                  aria-current={current ? "true" : undefined}
                  onClick={(event) => onLinkClick(event, trip.id)}
                >
                  <span>
                    <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
                  </span>
                </Link>
              </td>
              <td className="dispatch-game">
                <GameChip game={trip.game} />
              </td>
              <td className="dispatch-distance review-muted">
                {formatQuantity(trip.actualDistanceM, "km", locale)}
              </td>
              <td className="dispatch-reason review-muted">
                {state === "resolved" && <DispatchDecisionBadge decision={item.outcome} />}
                <ReviewReasonList codes={reasonCodes} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
