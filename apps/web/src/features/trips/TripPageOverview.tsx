import {
  Check,
  Circle,
  CircleHelp,
  Clock,
  type LucideIcon,
  Pencil,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button, Card } from "../../shared/ui/primitives.js";
import { HardModeBadge, SourceBadge, StatusBadge } from "./badges.js";
import { PlaceName, useWhen } from "./TripPageSections.js";
import { GameChip } from "./TripTable.js";
import type { CorrectionField } from "./correction-model.js";
import type { DTO } from "./transport.js";
import {
  type AcceptedLine,
  formatRoundedQuantity,
  type TripBanner,
  type TripStatus,
  tripHistory,
} from "./trip-page-model.js";

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

/** "+812 km in statistics and ETS2 qualification · reviewer, 10 Nov, 18:00". */
function CountedLine({ line }: { line: AcceptedLine }) {
  const { t, i18n } = useTranslation("trips"),
    when = useWhen(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    game = line.game.toUpperCase(),
    distance = line.distance ? formatRoundedQuantity(line.distance, "km", locale) : null,
    actor = line.system ? t("system") : line.actor,
    by = [actor, line.at ? when(line.at) : null].filter(Boolean).join(", ");
  return (
    <p className="trip-detail-counted">
      <Check size={14} strokeWidth={2.2} aria-hidden="true" focusable="false" />
      <span>
        {distance ? t("acceptedLine", { distance, game }) : t("acceptedLineNoDistance", { game })}
        {by && <span className="trip-muted"> · {by}</span>}
      </span>
    </p>
  );
}

/**
 * Route title with the status, the counted line of an accepted trip, the secondary line (number,
 * game, sources, Hard Mode and the driver for anyone but the owner) and the actions menu.
 */
export function TripHeader({
  summary,
  view,
  status,
  owner,
  counted,
  correctionPending,
  menu,
}: {
  summary: DTO["TripSummary"] | undefined;
  view: DTO["TripPrivate"] | null;
  status: TripStatus | null;
  owner: boolean;
  counted: AcceptedLine | null;
  correctionPending: boolean;
  menu: ReactNode;
}) {
  const { t } = useTranslation("trips"),
    label = useTripLabel(summary),
    hardMode = view?.effectiveFacts?.recordedTelemetry?.hardModeResult ?? summary?.hardModeResult,
    meta: { key: string; value: ReactNode }[] = [];
  if (summary) {
    if (summary.number !== undefined) meta.push({ key: "number", value: label });
    meta.push({ key: "game", value: <GameChip game={summary.game} /> });
    for (const kind of summary.sourceKinds)
      meta.push({ key: `source-${kind}`, value: <SourceBadge source={kind} /> });
    if (hardMode === "qualified")
      meta.push({ key: "hardMode", value: <HardModeBadge result={hardMode} /> });
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
                  {summary.origin ? <PlaceName value={summary.origin} /> : t("unknown")} →{" "}
                  {summary.destination ? <PlaceName value={summary.destination} /> : t("unknown")}
                </>
              ) : (
                label
              )}
            </h1>
            {status && <TripStatusBadge status={status} />}
          </div>
          {counted && <CountedLine line={counted} />}
          {correctionPending && <p className="trip-muted">{t("next_correction")}</p>}
          {meta.length > 0 && (
            <div className="trip-detail-meta">
              {meta.map(({ key, value }) => (
                <span key={key}>{value}</span>
              ))}
            </div>
          )}
        </div>
        {menu && <div className="trip-detail-actions">{menu}</div>}
      </div>
    </header>
  );
}

const bannerIcons: Record<TripBanner["status"], LucideIcon> = {
  pending_review: Clock,
  needs_fix: Pencil,
  rejected: X,
  in_progress: Circle,
  unassessed: CircleHelp,
  cancelled: X,
};

/**
 * The one status banner of a trip that is not accepted: status and whether it counts, one sentence,
 * the reviewer's comment and reasons, who and when, and at most one action (the owner's fix).
 */
export function TripStatusBanner({
  banner,
  fixPath,
  correctPath = null,
  fields = [],
  correctionPending = false,
}: {
  banner: TripBanner;
  /** The report editor of the owner's returned report. */
  fixPath: string | null;
  /** VTC-169: the correction page of the owner's returned telemetry trip. */
  correctPath?: string | null;
  /** The facts the owner can correct, named after the note. */
  fields?: readonly CorrectionField[];
  /** A pending driver correction titles the banner (variant A, VTC-169). */
  correctionPending?: boolean;
}) {
  const { t } = useTranslation("trips"),
    when = useWhen(),
    Icon = bannerIcons[banner.status],
    actor = banner.system ? t("system") : banner.actor,
    by =
      banner.status === "pending_review"
        ? banner.at && t("bannerSubmitted", { date: when(banner.at) })
        : [actor, banner.at ? when(banner.at) : null].filter(Boolean).join(", "),
    reasons = banner.reasonKeys.map((key) => t(key)).join(", ");
  return (
    <section
      className="trip-banner"
      data-tone={banner.tone}
      data-status={banner.status}
      aria-label={t("statusRegion")}
    >
      <span className="trip-banner-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2} focusable="false" />
      </span>
      <div className="trip-banner-body">
        <div className="trip-banner-title">
          <strong>
            {correctionPending ? t("correctionPendingTitle") : t(`status_${banner.status}`)}
          </strong>
          <span className="trip-banner-counted" data-counted={banner.counted}>
            {t(banner.counted === "no" ? "bannerNo" : "bannerNotYet")}
          </span>
        </div>
        <span className="trip-banner-text">
          {t(banner.noteKey)}
          {banner.heldKeys.length > 0 && (
            <InfoTip label={t("heldBecause")} title={t("heldBecause")}>
              <ul className="trip-detail-reasons">
                {banner.heldKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </InfoTip>
          )}
        </span>
        {banner.action === "fix" && !fixPath && fields.length > 0 && (
          <span className="trip-banner-text">
            {t("fixBannerFields", {
              fields: fields.map((field) => t(`correctField_${field}`)).join(", "),
            })}
          </span>
        )}
        {(banner.quote || reasons) && (
          <span className="trip-detail-quote">
            {banner.quote && t("quoted", { text: banner.quote })}
            {banner.quote && reasons && " · "}
            {reasons}
          </span>
        )}
        {by && <span className="trip-muted">{by}</span>}
      </div>
      {banner.action === "fix" && (fixPath || correctPath) && (
        <Button asChild className="trip-banner-action">
          {fixPath ? (
            <Link to={fixPath}>{t("fixReport")}</Link>
          ) : (
            <Link to={correctPath as string}>{t("fixTrip")}</Link>
          )}
        </Button>
      )}
    </section>
  );
}

/**
 * Receipts, submissions, the driver's corrections and decisions, oldest first, with reviewer
 * comments and reasons.
 */
export function TripHistory({
  view,
  proposals,
}: {
  view: DTO["TripPrivate"];
  proposals?: readonly DTO["TripProposal"][];
}) {
  const { t } = useTranslation("trips"),
    when = useWhen(),
    id = useId(),
    entries = tripHistory(view, proposals);
  return (
    <Card className="stack trip-detail-card" aria-labelledby={id}>
      <h2 id={id}>{t("reviewHistory")}</h2>
      {entries.length ? (
        <ol className="trip-detail-history">
          {entries.map((entry) => {
            const actor = entry.system ? t("system") : entry.actor,
              reasons = entry.reasonKeys.map((key) => t(key)).join(", ");
            return (
              <li key={entry.id} data-kind={entry.kind}>
                <span className="trip-detail-history-dot" aria-hidden="true" />
                <div className="trip-detail-history-body">
                  <span className="trip-detail-history-title">
                    <span>
                      {t(entry.titleKey, { number: entry.number })}
                      {reasons && `: ${reasons}`}
                    </span>
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
                    <span className="trip-muted trip-detail-quote">
                      {t("quoted", { text: entry.quote })}
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
