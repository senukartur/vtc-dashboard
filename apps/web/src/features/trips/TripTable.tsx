import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Badge, Table } from "../../shared/ui/primitives.js";
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

function CellLabel({ children }: { children: ReactNode }) {
  // Visible only on phone cards; the table header already names the column for assistive tech.
  return (
    <span className="trips-cell-label" aria-hidden="true">
      {children}
    </span>
  );
}

export function TripTable({
  items,
  selectedId,
  showOwner,
  linkFor,
  onLinkClick,
  timezone,
  footer,
}: {
  items: DTO["TripSummary"][];
  selectedId: string | null;
  showOwner: boolean;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  timezone: string;
  footer: ReactNode;
}) {
  const { t, i18n } = useTranslation("trips"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  return (
    <>
      {items.length ? (
        <Table className="trips-table">
          <caption className="visually-hidden">{t("listLabel")}</caption>
          <thead>
            <tr>
              <th scope="col" className="trips-col-route">
                {t("route")}
              </th>
              <th scope="col" className="trips-col-cargo">
                {t("cargo")}
              </th>
              <th scope="col" className="trips-col-distance trips-numeric">
                {t("distance")}
              </th>
              <th scope="col" className="trips-col-source">
                {t("source")}
              </th>
              <th scope="col" className="trips-col-decision">
                {t("decision")}
              </th>
              <th scope="col" className="trips-col-time">
                {t("reportingColumn")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((trip) => {
              const selected = trip.id === selectedId;
              return (
                <tr
                  key={trip.id}
                  className="trips-row"
                  data-selected={selected ? "true" : undefined}
                >
                  <td className="trips-route">
                    <CellLabel>{t("route")}</CellLabel>
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
                          <CatalogName value={trip.origin} /> →{" "}
                          <CatalogName value={trip.destination} />
                        </span>
                      </Link>
                    </span>
                    {showOwner && <span className="trips-owner">{trip.owner.nickname}</span>}
                  </td>
                  <td>
                    <CellLabel>{t("cargo")}</CellLabel>
                    <span>
                      <CatalogName value={trip.cargo} />
                    </span>
                  </td>
                  <td className="trips-numeric">
                    <CellLabel>{t("distance")}</CellLabel>
                    <span>{formatQuantity(trip.actualDistanceM, "km", locale)}</span>
                  </td>
                  <td className="trips-source trips-muted">
                    <CellLabel>{t("source")}</CellLabel>
                    <span>{sourceNames(trip, t)}</span>
                  </td>
                  <td>
                    <CellLabel>{t("decision")}</CellLabel>
                    <DecisionBadge decision={trip.decision} />
                  </td>
                  <td className="trips-muted">
                    <CellLabel>{t("reportingColumn")}</CellLabel>
                    <span id={`trip-time-${trip.id}`}>
                      {formatUtc(trip.reportingAt, locale, timezone)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <p className="trips-empty">{t("empty")}</p>
      )}
      <div className="trips-list-footer">{footer}</div>
    </>
  );
}
