import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn, type DataTableProps } from "../../shared/ui/DataTable.js";
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

type ReviewItem = DTO["TripStage3ReviewItem"];
type QueueState = Pick<
  DataTableProps<ReviewItem>,
  "status" | "busy" | "error" | "onRetry" | "empty" | "filtered" | "pagination"
>;

export function DispatchQueueTable({
  rows,
  resolved,
  selected,
  computedAt,
  timezone,
  linkFor,
  onLinkClick,
  state,
}: {
  rows: ReviewItem[] | undefined;
  resolved: boolean;
  selected: string | null;
  computedAt: string | undefined;
  timezone: string;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  state: QueueState;
}) {
  const { t, i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const now = computedAt ? Date.parse(computedAt) : Date.now();
  const columns: DataTableColumn<ReviewItem>[] = [
    {
      id: "age",
      header: t(resolved ? "dispatchDecisionTime" : "dispatchWaitAge"),
      cardLabel: false,
      className: "dispatch-age review-muted",
      cell: (item) => {
        const timestamp = item.state === "resolved" ? item.decidedAt : item.queuedAt;
        const age = Math.floor((now - Date.parse(timestamp)) / 1000);
        const time = formatUtc(timestamp, locale, timezone);
        return (
          <time dateTime={timestamp} title={time}>
            {item.state === "waiting" && Number.isFinite(age)
              ? queueAge(Math.max(age, 0), locale)
              : time}
          </time>
        );
      },
    },
    {
      id: "driver",
      header: t("owner"),
      cardLabel: false,
      className: "review-driver",
      cell: ({ trip }) => <span className="review-break">{trip.owner.nickname}</span>,
    },
    {
      id: "route",
      header: t("route"),
      cardLabel: false,
      className: "review-route",
      cell: ({ trip }) => (
        <Link
          id={`trip-link-${trip.id}`}
          className="review-link review-break"
          to={linkFor(trip.id)}
          aria-current={selected === trip.id ? "true" : undefined}
          onClick={(event) => onLinkClick(event, trip.id)}
        >
          <span>
            <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
          </span>
        </Link>
      ),
    },
    {
      id: "game",
      header: t("game"),
      cardLabel: false,
      className: "dispatch-game",
      cell: ({ trip }) => <GameChip game={trip.game} />,
    },
    {
      id: "distance",
      header: t("dispatchDistance"),
      cardLabel: false,
      className: "dispatch-distance review-muted",
      cell: ({ trip }) => formatQuantity(trip.actualDistanceM, "km", locale),
    },
    {
      id: "reason",
      header: t("dispatchReason"),
      cardLabel: false,
      className: "dispatch-reason review-muted",
      cell: (item) => (
        <>
          {item.state === "resolved" && <DispatchDecisionBadge decision={item.outcome} />}
          <ReviewReasonList codes={item.reasonCodes} />
        </>
      ),
    },
  ];
  return (
    <DataTable
      caption={t(resolved ? "dispatchResolved" : "queueLabel")}
      columns={columns}
      rows={rows}
      rowKey={({ trip }) => trip.id}
      rowAttributes={({ trip }) => ({
        className: "review-row",
        "data-selected": selected === trip.id ? "true" : undefined,
      })}
      className="review-table dispatch-table"
      tableProps={{ id: "review-queue-table", tabIndex: -1 }}
      {...state}
    />
  );
}
