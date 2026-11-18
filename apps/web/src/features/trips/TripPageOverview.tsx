import { TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { shortDate } from "../review/review-model.js";
import { HardModeBadge, SourceBadge, StatusBadge } from "./badges.js";
import { UnknownValue, useTripDisplay } from "./TripPageSections.js";
import { CatalogName, GameChip } from "./TripTable.js";
import type { DTO } from "./transport.js";
import {
  creditState,
  distanceNote,
  type NextStep,
  type TripStatus,
  tripHistory,
} from "./trip-page-model.js";

/** Short day, month and time in the display zone, or the full form when it cannot be shortened. */
function useWhen() {
  const { locale, timezone } = useTripDisplay();
  return (value: string) =>
    shortDate(value, locale, timezone) ?? formatUtc(value, locale, timezone);
}

export function TripStatusBadge({ status }: { status: TripStatus }) {
  return <StatusBadge status={status} className="trip-detail-status" />;
}

/** "Trip #N" when the server assigned a number, otherwise "Trip". */
export function useTripLabel(summary: DTO["TripSummary"] | undefined) {
  const { t } = useTranslation("trips");
  return summary?.number === undefined
    ? t("tripTitle")
    : t("tripNumber", { number: summary.number });
}

/**
 * Route title with the status, the secondary line (number, game, sources, completion and
 * the driver for staff) and the page actions.
 */
export function TripHeader({
  summary,
  view,
  status,
  owner,
  actions,
}: {
  summary: DTO["TripSummary"] | undefined;
  view: DTO["TripPrivate"] | null;
  status: TripStatus | null;
  owner: boolean;
  actions: ReactNode;
}) {
  const { t } = useTranslation("trips"),
    when = useWhen(),
    label = useTripLabel(summary),
    completed = view?.effectiveFacts?.actualCompletedAt ?? null,
    meta: { key: string; value: ReactNode }[] = [];
  if (summary) {
    if (summary.number !== undefined) meta.push({ key: "number", value: label });
    meta.push({ key: "game", value: <GameChip game={summary.game} /> });
    if (summary.sourceKinds.length)
      meta.push({
        key: "sources",
        value: (
          <span className="trip-source-badges">
            {summary.sourceKinds.map((kind) => (
              <SourceBadge key={kind} source={kind} />
            ))}
          </span>
        ),
      });
    if (completed)
      meta.push({ key: "completed", value: t("completedOn", { date: when(completed) }) });
    if (!owner)
      meta.push({ key: "driver", value: t("driverName", { name: summary.owner.nickname }) });
  }
  return (
    <header className="trip-detail-header">
      <div className="trip-detail-heading">
        <div className="trip-detail-title">
          <div className="trip-detail-title-row">
            <h1>
              {summary && (summary.origin || summary.destination) ? (
                <>
                  <CatalogName value={summary.origin} /> →{" "}
                  <CatalogName value={summary.destination} />
                </>
              ) : (
                label
              )}
            </h1>
            {status && <TripStatusBadge status={status} />}
            <HardModeBadge result={view?.effectiveFacts?.recordedTelemetry?.hardModeResult} />
          </div>
          {meta.length > 0 && (
            <p className="trip-detail-meta">
              {meta.map(({ key, value }, index) => (
                <span key={key}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  {value}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="trip-detail-actions">{actions}</div>
      </div>
    </header>
  );
}

function Tile({
  label,
  children,
  attention = false,
}: {
  label: string;
  children: ReactNode;
  attention?: boolean;
}) {
  return (
    <div className="card trip-detail-tile" data-attention={attention || undefined}>
      <span className="trip-detail-tile-label">{label}</span>
      {children}
    </div>
  );
}

/** Distance, credit and the next step; the step appears only for the owner and staff. */
export function TripTiles({
  summary,
  facts,
  next,
  fixPending,
}: {
  summary: DTO["TripSummary"];
  facts: DTO["EffectiveTripFacts"] | null | undefined;
  next: NextStep | null;
  /** A rejected report awaits its driver's fix (`awaitingFix`), so it is not counted yet. */
  fixPending: boolean;
}) {
  const { t } = useTranslation("trips"),
    { locale } = useTripDisplay(),
    when = useWhen(),
    distance = distanceNote(summary, facts),
    credit = creditState(summary, fixPending),
    distanceNotes = [
      distance.sourceKey && t(distance.sourceKey),
      distance.noTelemetry && t("distanceNoTelemetry"),
    ].filter(Boolean);
  return (
    <section aria-label={t("summaryRegion")} className="trip-detail-tiles">
      <Tile label={t("tileDistance")}>
        <strong className="trip-detail-tile-value">
          {distance.value === null ? (
            <UnknownValue hint="distanceUnknownHelp" />
          ) : (
            formatQuantity(distance.value, "km", locale)
          )}
        </strong>
        {distanceNotes.length > 0 && (
          <span className="trip-muted">{distanceNotes.join(" · ")}</span>
        )}
      </Tile>
      <Tile label={t("tileCredited")}>
        <strong className="trip-detail-tile-value">{t(credit.valueKey)}</strong>
        <span className="trip-detail-tile-note">
          <span className="trip-muted">
            {t(credit.noteKey, { date: credit.at ? when(credit.at) : "" })}
          </span>
          {credit.basisKey && (
            <InfoTip label={t("creditedInfoLabel")}>
              <p>{t(credit.basisKey)}</p>
            </InfoTip>
          )}
        </span>
      </Tile>
      {next && (
        <Tile label={t("tileNext")} attention={next.attention}>
          <strong className="trip-detail-tile-value">{t(next.titleKey)}</strong>
          {next.reason ? (
            <span className="trip-detail-quote">
              {next.reviewer ?? t("system")}: {t("quoted", { text: next.reason })}
            </span>
          ) : (
            <span className="trip-detail-tile-note">
              <span className="trip-muted">{t(next.noteKey)}</span>
              {next.held && next.reasonKeys.length > 0 && (
                <InfoTip label={t("heldBecause")} title={t("heldBecause")}>
                  <ul className="trip-detail-reasons">
                    {next.reasonKeys.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                </InfoTip>
              )}
            </span>
          )}
          {!next.held && next.reasonKeys.length > 0 && (
            <span className="trip-muted">{next.reasonKeys.map((key) => t(key)).join(", ")}</span>
          )}
        </Tile>
      )}
    </section>
  );
}

/** Receipts, submissions and decisions, oldest first, with reviewer comments and reasons. */
export function TripHistory({ view }: { view: DTO["TripPrivate"] }) {
  const { t } = useTranslation("trips"),
    when = useWhen(),
    id = useId(),
    entries = tripHistory(view);
  return (
    <Card className="stack trip-detail-card" aria-labelledby={id}>
      <h2 id={id}>{t("reviewHistory")}</h2>
      {entries.length ? (
        <ol className="trip-detail-history">
          {entries.map((entry) => {
            const actor = entry.system ? t("system") : entry.actor;
            return (
              <li key={entry.id} data-kind={entry.kind}>
                <span className="trip-detail-history-dot" aria-hidden="true" />
                <div className="trip-detail-history-body">
                  <span className="trip-detail-history-title">
                    {t(entry.titleKey, { number: entry.number })}
                    {entry.overLimits && (
                      <Badge tone="warn" icon={TriangleAlert} className="review-marker">
                        {t("overLimitsMarker")}
                      </Badge>
                    )}
                  </span>
                  <span className="trip-muted">
                    {when(entry.at)}
                    {actor && ` · ${actor}`}
                  </span>
                  {entry.quote && (
                    <span className="trip-detail-quote">{t("quoted", { text: entry.quote })}</span>
                  )}
                  {entry.reasonKeys.length > 0 && (
                    <span className="trip-muted">
                      {entry.reasonKeys.map((key) => t(key)).join(", ")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="trip-muted">{t("noHistory")}</p>
      )}
    </Card>
  );
}
