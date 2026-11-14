import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { formatUtc } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn, type DataTableProps } from "../../shared/ui/DataTable.js";
import { Badge } from "../../shared/ui/primitives.js";
import { CatalogName, GameChip } from "../trips/TripTable.js";
import type { DTO } from "../trips/transport.js";
import {
  isOwn,
  queueType,
  type RuleFlag,
  ruleFlag,
  shortDate,
  submittedAt,
} from "./review-model.js";

// Decorative symbols beside the flag text, so the rules state never relies on colour alone.
const flagSymbol: Record<RuleFlag, string> = { exceeded: "!", check: "?", none: "✓" };

/** Short visible text for a constrained cell; assistive technology reads the full text. */
function Short({ short, full }: { short: ReactNode; full: ReactNode }) {
  return (
    <>
      <span aria-hidden="true">{short}</span>
      <span className="visually-hidden">{full}</span>
    </>
  );
}

type Trip = DTO["TripSummary"];
export type ReviewQueueState = Pick<
  DataTableProps<Trip>,
  "status" | "busy" | "error" | "onRetry" | "empty" | "filtered" | "pagination" | "footer"
>;

/**
 * Compact dispatch queue: driver, route, queue type, revision, rules flag and filing time. The
 * route link is the row's only control; phone widths stack each row into three lines. The API
 * orders the queue by creation time, not by the filing time shown, so no header sorts.
 */
export function ReviewQueueTable({
  items,
  selectedId,
  memberId,
  timezone,
  linkFor,
  onLinkClick,
  state,
}: {
  items: Trip[] | undefined;
  selectedId: string | null;
  memberId: string | undefined;
  timezone: string;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  state: ReviewQueueState;
}) {
  const { t, i18n } = useTranslation("trips"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const columns: DataTableColumn<Trip>[] = [
    {
      id: "driver",
      header: t("owner"),
      cardLabel: false,
      className: "review-col-driver review-driver",
      cell: (trip) => (
        <>
          <span className="review-break">{trip.owner.nickname}</span>
          {isOwn(trip, memberId) && (
            <small className="review-you">
              <Short short={t("you")} full={`(${t("youFull")})`} />
            </small>
          )}
        </>
      ),
    },
    {
      id: "route",
      header: t("route"),
      cardLabel: false,
      className: "review-col-route review-route",
      cell: (trip) => (
        <span className="review-route-line">
          <GameChip game={trip.game} />
          <Link
            id={`trip-link-${trip.id}`}
            className="review-link"
            to={linkFor(trip.id)}
            aria-current={trip.id === selectedId ? "true" : undefined}
            aria-describedby={`review-type-${trip.id}`}
            onClick={(event) => onLinkClick(event, trip.id)}
          >
            <span>
              <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
            </span>
          </Link>
        </span>
      ),
    },
    {
      id: "type",
      header: t("queueType"),
      cardLabel: false,
      className: "review-col-type review-type review-muted",
      cell: (trip) => <span id={`review-type-${trip.id}`}>{t(`type_${queueType(trip)}`)}</span>,
    },
    {
      id: "revision",
      header: <Short short={t("revisionShort")} full={t("revision")} />,
      cardLabel: false,
      className: "review-col-revision review-revision review-muted",
      cell: (trip) => {
        const number = trip.review?.manualRevision?.number ?? null;
        return number ? (
          <Short short={`№ ${number}`} full={t("revisionNumber", { number })} />
        ) : (
          <Short short="—" full={t("noRevision")} />
        );
      },
    },
    {
      id: "rules",
      header: t("queueRules"),
      cardLabel: false,
      className: "review-col-rules review-rules",
      cell: (trip) => {
        const flag = ruleFlag(trip.review?.reasonCodes ?? []);
        return (
          <Badge className="review-flag" data-flag={flag}>
            <span aria-hidden="true">{flagSymbol[flag]}</span>
            <Short short={t(`flag_${flag}`)} full={t(`flag_${flag}_full`)} />
          </Badge>
        );
      },
    },
    {
      id: "filed",
      header: t("filed"),
      cardLabel: false,
      className: "review-col-filed review-filed review-muted",
      cell: (trip) => {
        const filed = submittedAt(trip),
          short = shortDate(filed, locale, timezone);
        return filed && short ? (
          <time dateTime={filed}>
            <Short short={short} full={formatUtc(filed, locale, timezone)} />
          </time>
        ) : (
          t("unknown")
        );
      },
    },
  ];
  return (
    <DataTable
      className="review-table"
      caption={t("queueLabel")}
      tableProps={{ id: "review-queue-table", tabIndex: -1 }}
      columns={columns}
      rows={items}
      rowKey={(trip) => trip.id}
      rowAttributes={(trip) => ({
        className: "review-row",
        "data-selected": trip.id === selectedId ? "true" : undefined,
        "data-own": isOwn(trip, memberId) ? "true" : undefined,
      })}
      {...state}
    />
  );
}
