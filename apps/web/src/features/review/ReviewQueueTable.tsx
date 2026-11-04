import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, type To } from "react-router-dom";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Table } from "../../shared/ui/primitives.js";
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

/**
 * Compact dispatch queue: driver, route, queue type, revision, rules flag and filing time. The
 * route link is the row's only control; phone widths stack each row into three lines.
 */
export function ReviewQueueTable({
  items,
  selectedId,
  memberId,
  timezone,
  linkFor,
  onLinkClick,
}: {
  items: DTO["TripSummary"][];
  selectedId: string | null;
  memberId: string | undefined;
  timezone: string;
  linkFor: (id: string) => To;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const { t, i18n } = useTranslation("trips"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  return (
    <Table id="review-queue-table" className="review-table" tabIndex={-1}>
      <caption className="visually-hidden">{t("queueLabel")}</caption>
      <thead>
        <tr>
          <th scope="col" className="review-col-driver">
            {t("owner")}
          </th>
          <th scope="col" className="review-col-route">
            {t("route")}
          </th>
          <th scope="col" className="review-col-type">
            {t("queueType")}
          </th>
          <th scope="col" className="review-col-revision">
            <Short short={t("revisionShort")} full={t("revision")} />
          </th>
          <th scope="col" className="review-col-rules">
            {t("queueRules")}
          </th>
          <th scope="col" className="review-col-filed">
            {t("filed")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((trip) => {
          const selected = trip.id === selectedId,
            own = isOwn(trip, memberId),
            flag = ruleFlag(trip.review?.reasonCodes ?? []),
            number = trip.review?.manualRevision?.number ?? null,
            filed = submittedAt(trip),
            short = shortDate(filed, locale, timezone);
          return (
            <tr
              key={trip.id}
              className="review-row"
              data-selected={selected ? "true" : undefined}
              data-own={own ? "true" : undefined}
            >
              <td className="review-driver">
                <span className="review-break">{trip.owner.nickname}</span>
                {own && (
                  <small className="review-you">
                    <Short short={t("you")} full={`(${t("youFull")})`} />
                  </small>
                )}
              </td>
              <td className="review-route">
                <span className="review-route-line">
                  <GameChip game={trip.game} />
                  <Link
                    id={`trip-link-${trip.id}`}
                    className="review-link"
                    to={linkFor(trip.id)}
                    aria-current={selected ? "true" : undefined}
                    aria-describedby={`review-type-${trip.id}`}
                    onClick={(event) => onLinkClick(event, trip.id)}
                  >
                    <span>
                      <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
                    </span>
                  </Link>
                </span>
              </td>
              <td className="review-type review-muted">
                <span id={`review-type-${trip.id}`}>{t(`type_${queueType(trip)}`)}</span>
              </td>
              <td className="review-revision review-muted">
                {number ? (
                  <Short short={`№ ${number}`} full={t("revisionNumber", { number })} />
                ) : (
                  <Short short="—" full={t("noRevision")} />
                )}
              </td>
              <td className="review-rules">
                <Badge className="review-flag" data-flag={flag}>
                  <span aria-hidden="true">{flagSymbol[flag]}</span>
                  <Short short={t(`flag_${flag}`)} full={t(`flag_${flag}_full`)} />
                </Badge>
              </td>
              <td className="review-filed review-muted">
                {filed && short ? (
                  <time dateTime={filed}>
                    <Short short={short} full={formatUtc(filed, locale, timezone)} />
                  </time>
                ) : (
                  t("unknown")
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
