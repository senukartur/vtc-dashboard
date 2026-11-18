import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn, type DataTableProps } from "../../shared/ui/DataTable.js";
import { Badge } from "../../shared/ui/primitives.js";
import { shortDate } from "../review/review-model.js";
import {
  formatTripRevenue,
  roundedTripDistanceM,
  type TripOrder,
  tripListTimestamp,
} from "./list-model.js";
import type { DTO } from "./transport.js";
import "./trips-list.css";

import {
  GameModeBadge,
  HardModeBadge,
  JobTypeBadge,
  OutcomeBadge,
  RecordingBadge,
  SourceBadge,
  StatusBadge,
} from "./badges.js";

type Decision = DTO["TripSummary"]["decision"];

export function CatalogName({ value }: { value: DTO["CatalogLabel"] | null }) {
  const { t } = useTranslation("trips");
  return (
    <>
      {value?.label ?? t("unknown")}
      <CatalogNativeName value={value} />
      {value?.englishFallback && (
        <small className="trip-fallback"> · {t("catalogs:fallback")}</small>
      )}
    </>
  );
}

export function GameChip({ game }: { game: DTO["TripSummary"]["game"] }) {
  return (
    <Badge tone={game} className="trips-game" data-game={game}>
      {game.toUpperCase()}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  return <StatusBadge status={decision} className="trips-decision" />;
}

export function sourceNames(trip: DTO["TripSummary"], t: (key: string) => string) {
  return trip.sourceKinds.length ? trip.sourceKinds.map((s) => t(s)).join(" + ") : t("unknown");
}

type Trip = DTO["TripSummary"];
export type TripTableState = Pick<
  DataTableProps<Trip, "completion">,
  "status" | "busy" | "error" | "onRetry" | "empty" | "filtered" | "pagination"
>;

export function TripTable({
  items,
  showOwner,
  timezone,
  order,
  onOrder,
  state,
}: {
  items: Trip[] | undefined;
  showOwner: boolean;
  timezone: string;
  order: TripOrder;
  onOrder: (order: TripOrder) => void;
  state: TripTableState;
}) {
  const { t, i18n } = useTranslation("trips"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const columns: DataTableColumn<Trip, "completion">[] = [
    {
      id: "number",
      header: t("tripIdColumn"),
      className: "trips-col-number",
      cell: (trip) => (
        <span className="trips-number">{trip.number === undefined ? "—" : `#${trip.number}`}</span>
      ),
    },
    {
      id: "completion",
      header: t("completion"),
      cardLabel: t("completionColumn"),
      className: "trips-col-time trips-muted",
      sort: {
        key: "completion",
        defaultDirection: "desc",
        options: { desc: t("newestFirst"), asc: t("oldestFirst") },
      },
      cell: (trip) => {
        const timestamp = tripListTimestamp(trip);
        return (
          <span id={`trip-time-${trip.id}`} className="trips-cell-stack">
            <span title={formatUtc(timestamp?.at ?? null, locale, timezone)}>
              {shortDate(timestamp?.at ?? null, locale, timezone) ??
                formatUtc(timestamp?.at ?? null, locale, timezone)}
            </span>
            {timestamp?.label && <small className="trips-time-basis">{t(timestamp.label)}</small>}
          </span>
        );
      },
    },
    {
      id: "game",
      header: t("gameAndMode"),
      className: "trips-col-game",
      cell: (trip) => (
        <span className="trips-cell-stack">
          <span className="trips-game-line">
            <GameChip game={trip.game} />
            <HardModeBadge result={trip.hardModeResult} compact />
          </span>
          <GameModeBadge mode={trip.gameMode} />
        </span>
      ),
    },
    {
      id: "cargo",
      header: t("cargo"),
      className: "trips-col-cargo",
      cell: (trip) => (
        <span className="trips-cell-stack">
          <span className="trips-cargo-name">
            <CatalogName value={trip.cargo} />
          </span>
        </span>
      ),
    },
    {
      id: "jobType",
      header: t("recordedJobType"),
      className: "trips-col-job",
      cell: (trip) =>
        trip.jobType ? <JobTypeBadge job={trip.jobType} /> : <span className="trips-muted">—</span>,
    },
    {
      id: "route",
      header: t("route"),
      className: "trips-col-route trips-route",
      cell: (trip) => (
        <>
          <Link
            id={`trip-link-${trip.id}`}
            className="trips-link"
            to={`/account/trips/${trip.id}`}
            aria-describedby={`trip-time-${trip.id}`}
          >
            <span>
              <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
            </span>
          </Link>
          <span className="trips-bases">
            {trip.originCompany || trip.destinationCompany ? (
              <>
                <span>
                  {trip.originCompany?.state === "resolved"
                    ? trip.originCompany.name
                    : (trip.originCompany?.code ?? t("notSpecified"))}
                </span>
                <span aria-hidden="true"> · </span>
                <span>
                  {trip.destinationCompany?.state === "resolved"
                    ? trip.destinationCompany.name
                    : (trip.destinationCompany?.code ?? t("notSpecified"))}
                </span>
              </>
            ) : (
              t("basesUnavailable")
            )}
          </span>
          {showOwner && <span className="trips-owner">{trip.owner.nickname}</span>}
          {!showOwner && trip.event && (
            <span className="trips-row-meta">
              <Link to={`/account/events/${trip.event.id}`}>{trip.event.title}</Link>
            </span>
          )}
        </>
      ),
    },
    {
      id: "distance",
      header: t("listDistance"),
      align: "end",
      className: "trips-col-distance",
      cell: (trip) => (
        <span className="trips-distance">
          {formatQuantity(roundedTripDistanceM(trip.actualDistanceM), "km", locale)}
        </span>
      ),
    },
    {
      id: "revenue",
      header: t("revenue"),
      align: "end",
      className: "trips-col-revenue",
      cell: (trip) =>
        trip.revenue ? (
          <span className="trips-revenue">
            <span>
              {formatTripRevenue(trip.revenue.amount, locale)}
              {trip.revenue.currency ? ` ${trip.revenue.currency}` : ""}
            </span>
            {!trip.revenue.currency && <small>{t("currencyUnknown")}</small>}
          </span>
        ) : (
          <span className="trips-muted">—</span>
        ),
    },
    {
      id: "outcome",
      header: t("listOutcome"),
      className: "trips-col-outcome",
      cell: (trip) => <OutcomeBadge outcome={trip.outcome} />,
    },
    {
      id: "recording",
      header: t("recording"),
      className: "trips-col-recording",
      cell: (trip) => <RecordingBadge recording={trip.recording} />,
    },
    {
      id: "decision",
      header: t("decision"),
      className: "trips-col-decision",
      cell: (trip) => (
        <span className="trips-cell-stack">
          <DecisionBadge decision={trip.decision} />
          <span className="trips-secondary-status">
            <OutcomeBadge outcome={trip.outcome} />
            <RecordingBadge recording={trip.recording} />
          </span>
        </span>
      ),
    },
    {
      id: "source",
      header: t("source"),
      className: "trips-col-source trips-muted",
      cell: (trip) => (
        <span className="trips-cell-stack">
          {trip.sourceKinds.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </span>
      ),
    },
    {
      id: "open",
      header: <span className="visually-hidden">{t("open")}</span>,
      cardLabel: false,
      className: "trips-col-open",
      cell: () => (
        <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} className="trips-chevron" />
      ),
    },
  ];
  // Each cell has a native link overlay, including its padding. Only the route link is exposed
  // to keyboard and screen-reader navigation. Cell positioning works across table-row engines.
  const linkedColumns = columns.map((column) =>
    column.id === "route"
      ? column
      : {
          ...column,
          cell: (trip: Trip) => (
            <>
              {column.cell(trip)}
              <Link
                className="trips-cell-link"
                to={`/account/trips/${trip.id}`}
                tabIndex={-1}
                aria-hidden="true"
              >
                <span className="visually-hidden">{t("open")}</span>
              </Link>
            </>
          ),
        },
  );
  return (
    <DataTable
      className="trips-table"
      caption={t("listLabel")}
      columns={linkedColumns}
      rows={items}
      rowKey={(trip) => trip.id}
      rowAttributes={() => ({ className: "trips-row" })}
      cardsBelow={800}
      sort={{
        value: { key: "completion", direction: order === "completion_asc" ? "asc" : "desc" },
        onChange: (next) =>
          onOrder(next.direction === "asc" ? "completion_asc" : "completion_desc"),
        label: t("completionOrder"),
      }}
      {...state}
    />
  );
}
