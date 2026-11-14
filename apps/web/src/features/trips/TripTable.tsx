import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn, type DataTableProps } from "../../shared/ui/DataTable.js";
import { Badge } from "../../shared/ui/primitives.js";
import { type TripOrder, tripListTimestamp } from "./list-model.js";
import type { DTO } from "./transport.js";
import "./trips-list.css";

type Decision = DTO["TripSummary"]["decision"];
// Decorative symbols beside the decision text, so status never relies on colour alone.
const decisionSymbol: Record<Decision, string | null> = {
  unassessed: null,
  pending_review: "●",
  accepted: "✓",
  rejected: "✕",
};

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
    <span className="trips-game" data-game={game}>
      {game.toUpperCase()}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const { t } = useTranslation("trips"),
    symbol = decisionSymbol[decision];
  return (
    <Badge className="trips-decision" data-decision={decision}>
      {symbol && <span aria-hidden="true">{symbol}</span>}
      {t(decision)}
    </Badge>
  );
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
  selectedId,
  showOwner,
  linkFor,
  onLinkClick,
  timezone,
  order,
  onOrder,
  state,
}: {
  items: Trip[] | undefined;
  selectedId: string | null;
  showOwner: boolean;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  timezone: string;
  order: TripOrder;
  onOrder: (order: TripOrder) => void;
  state: TripTableState;
}) {
  const { t, i18n } = useTranslation("trips"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const columns: DataTableColumn<Trip, "completion">[] = [
    {
      id: "route",
      header: t("route"),
      className: "trips-col-route trips-route",
      cell: (trip) => {
        const selected = trip.id === selectedId;
        return (
          <>
            <span className="trips-route-line">
              <GameChip game={trip.game} />
              <Link
                id={`trip-link-${trip.id}`}
                className="trips-link"
                to={linkFor(trip.id)}
                aria-current={selected ? "true" : undefined}
                aria-describedby={`trip-time-${trip.id}`}
                onClick={(event) => onLinkClick(event, trip.id)}
              >
                <span>
                  {trip.number !== undefined && (
                    <span className="trips-number">#{trip.number} </span>
                  )}
                  <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
                </span>
              </Link>
            </span>
            {showOwner && <span className="trips-owner">{trip.owner.nickname}</span>}
            {!showOwner && (trip.event || trip.gameMode) && (
              <span className="trips-row-meta">
                {trip.gameMode && (
                  <span>
                    {t(
                      trip.gameMode === "unknown"
                        ? "recordedUnknown"
                        : `telemetryMode_${trip.gameMode}`,
                    )}
                  </span>
                )}
                {trip.event && (
                  <Link to={`/account/events/${trip.event.id}`}>{trip.event.title}</Link>
                )}
              </span>
            )}
          </>
        );
      },
    },
    {
      id: "cargo",
      header: t("cargo"),
      className: "trips-col-cargo",
      cell: (trip) => (
        <span>
          <CatalogName value={trip.cargo} />
        </span>
      ),
    },
    {
      id: "distance",
      header: t("distance"),
      align: "end",
      className: "trips-col-distance",
      cell: (trip) => <span>{formatQuantity(trip.actualDistanceM, "km", locale)}</span>,
    },
    {
      id: "source",
      header: t("source"),
      className: "trips-col-source trips-source trips-muted",
      cell: (trip) => <span>{sourceNames(trip, t)}</span>,
    },
    {
      id: "decision",
      header: t("decision"),
      className: "trips-col-decision",
      cell: (trip) => <DecisionBadge decision={trip.decision} />,
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
          <span id={`trip-time-${trip.id}`}>
            {formatUtc(timestamp?.at ?? null, locale, timezone)}
            {timestamp?.label && <small className="trips-time-basis">{t(timestamp.label)}</small>}
          </span>
        );
      },
    },
  ];
  return (
    <DataTable
      className="trips-table"
      caption={t("listLabel")}
      columns={columns}
      rows={items}
      rowKey={(trip) => trip.id}
      rowAttributes={(trip) => ({
        className: "trips-row",
        "data-selected": trip.id === selectedId ? "true" : undefined,
      })}
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
