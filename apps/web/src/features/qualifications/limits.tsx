import type { TFunction } from "i18next";
import { Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import {
  accountTimeZone,
  formatQuantity,
  formatUtc,
  type Locale,
} from "../../shared/formatting.js";
import { LabelBadge } from "../../shared/ui/label-badge.js";
import { Badge } from "../../shared/ui/primitives.js";
import { percent, setLimits } from "./model.js";

export { failureText } from "./model.js";

import type { Conditions, DTO, Limits } from "./transport.js";

type T = TFunction<"qualifications">;
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === "en" ? "en" : "ru";
}
/** A bounded range in display units; both bounds are inclusive. */
export function rangeText(
  t: T,
  min: string | null,
  max: string | null,
  unit: "km" | "t",
  locale: Locale,
) {
  const format = (value: string) => formatQuantity(value, unit, locale);
  if (min !== null && max !== null)
    return t("rangeBoth", { min: format(min).replace(/\s\S+$/, ""), max: format(max) });
  if (min !== null) return t("rangeMin", { min: format(min) });
  if (max !== null) return t("rangeMax", { max: format(max) });
  return t("unlimited");
}
export function adrText(t: T, limits: Limits) {
  if (limits.adr.mode === "forbidden") return t("adrForbidden");
  if (limits.adr.mode === "any") return t("adrAny");
  return limits.adr.classes.join(", ") || t("adrSelected");
}
export function trailersText(t: T, limits: Limits) {
  if (limits.trailers.mode === "any") return t("trailersAny");
  const [first, ...rest] = limits.trailers.types;
  return first
    ? rest.length
      ? t("trailersMore", { first: first.label, count: rest.length })
      : first.label
    : t("trailersSelected");
}
/** The "→ next" need text of a level: distance and/or trips, or why there is no promotion. */
export function needText(t: T, conditions: Conditions, locale: Locale) {
  const distance =
    conditions.requiredDistanceM === null
      ? null
      : formatQuantity(conditions.requiredDistanceM, "km", locale);
  const trips =
    conditions.requiredTrips === null ? null : t("trips", { count: conditions.requiredTrips });
  if (distance && trips) return t("needBoth", { distance, trips });
  return distance ?? trips ?? t("noConditions");
}
function trailersFull(t: T, limits: Limits) {
  if (limits.trailers.mode === "any") return t("trailersAny");
  return limits.trailers.types.map((type) => type.label).join(", ") || t("trailersSelected");
}
/**
 * Before → after lines of a history entry, one per changed value; empty when either side is
 * missing (created, removed and entries recorded without values).
 */
export function historyDiffs(
  t: T,
  values: DTO["QualificationLevelHistoryEntry"]["values"],
  locale: Locale,
) {
  type Side = DTO["QualificationLevelHistoryValues"];
  if (!values?.before || !values.after) return [];
  const before: Side = values.before,
    after: Side = values.after;
  const pair = (label: string, read: (side: Side) => string) =>
    [label, read(before), read(after)] as const;
  return [
    pair(t("diffName"), (side) => side.name),
    pair(t("diffPosition"), (side) => String(side.position ?? "—")),
    pair(t("massLabel"), (side) =>
      rangeText(t, side.limits.massMinKg, side.limits.massMaxKg, "t", locale),
    ),
    pair(t("distanceLabel"), (side) =>
      rangeText(t, side.limits.distanceMinM, side.limits.distanceMaxM, "km", locale),
    ),
    pair(t("trailersLabel"), (side) => trailersFull(t, side.limits)),
    pair(t("adrLabel"), (side) => adrText(t, side.limits)),
    pair(t("hardMode"), (side) =>
      t(side.limits.hardModeRequired ? "hardModeRequired" : "hardModeOptional"),
    ),
    pair(t("diffConditions"), (side) => needText(t, side.conditions, locale)),
  ]
    .filter(([, from, to]) => from !== to)
    .map(([label, from, to]) => ({ label, from, to }));
}
/** Compact chips of the set limits; a level without limits credits any trip. */
export function LimitChips({ limits }: { limits: Limits }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    set = setLimits(limits);
  const chips = [
    set.mass &&
      `${t("massLabel")} ${rangeText(t, limits.massMinKg, limits.massMaxKg, "t", locale)}`,
    set.distance &&
      `${t("distanceLabel")} ${rangeText(t, limits.distanceMinM, limits.distanceMaxM, "km", locale)}`,
    set.trailers && trailersText(t, limits),
    set.adr &&
      (limits.adr.mode === "forbidden"
        ? t("adrChipForbidden")
        : t("adrChipClasses", { classes: limits.adr.classes.join(", ") })),
  ].filter((chip): chip is string => !!chip);
  if (!chips.length && !set.hardMode)
    return <span className="qualification-muted">{t("anyTrips")}</span>;
  return (
    <span className="qualification-chips">
      {chips.map((chip) => (
        <LabelBadge key={chip}>{chip}</LabelBadge>
      ))}
      {set.hardMode && (
        <Badge tone="ok" icon={Flame}>
          {t("hardMode")}
        </Badge>
      )}
    </span>
  );
}
/** All five limits with their configured values, as the detail and the editor summary show them. */
export function LimitList({ limits }: { limits: Limits }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale();
  return (
    <dl className="qualification-limit-list">
      <div>
        <dt>{t("massLabel")}</dt>
        <dd>{rangeText(t, limits.massMinKg, limits.massMaxKg, "t", locale)}</dd>
      </div>
      <div>
        <dt>{t("distanceLabel")}</dt>
        <dd>{rangeText(t, limits.distanceMinM, limits.distanceMaxM, "km", locale)}</dd>
      </div>
      <div>
        <dt>{t("trailersLabel")}</dt>
        <dd>
          {limits.trailers.mode === "any" ? (
            t("trailersAny")
          ) : limits.trailers.types.length === 0 ? (
            // An editor draft before the first trailer type is added.
            t("trailersSelected")
          ) : (
            <span className="qualification-chips">
              {limits.trailers.types.map((type) => (
                <LabelBadge key={type.entityId}>{type.label}</LabelBadge>
              ))}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>{t("adrLabel")}</dt>
        <dd>
          {limits.adr.mode === "selected" && limits.adr.classes.length > 0 ? (
            <span className="qualification-chips">
              {limits.adr.classes.map((value) => (
                <LabelBadge key={value}>{t(`adr${value}`)}</LabelBadge>
              ))}
            </span>
          ) : (
            adrText(t, limits)
          )}
        </dd>
      </div>
      <div>
        <dt className="qualification-hard-mode">
          <Flame size={13} strokeWidth={1.8} aria-hidden="true" />
          {t("hardMode")}
        </dt>
        <dd>{t(limits.hardModeRequired ? "hardModeRequired" : "hardModeOptional")}</dd>
      </div>
    </dl>
  );
}
/** Exact value text with a decorative bar. */
export function ProgressRow({
  label,
  value,
  required,
  text,
}: {
  label: string;
  value: string | number;
  required: string | number | null;
  text: string;
}) {
  const share = percent(value, required);
  return (
    <div className="qualification-progress-row">
      <span>{label}</span>
      <strong>{text}</strong>
      {share !== null && (
        <span className="qualification-bar" aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </span>
      )}
    </div>
  );
}
export function progressRows(
  t: T,
  progress: DTO["QualificationProgress"],
  conditions: Conditions | null,
  locale: Locale,
) {
  return [
    ...(conditions?.requiredDistanceM !== null && conditions
      ? [
          {
            key: "distance",
            label: t("distanceOnLevel"),
            value: progress.distanceM,
            required: conditions.requiredDistanceM,
            text: `${formatQuantity(progress.distanceM, "km", locale)} / ${formatQuantity(conditions.requiredDistanceM, "km", locale)}`,
          },
        ]
      : []),
    ...(conditions?.requiredTrips !== null && conditions
      ? [
          {
            key: "trips",
            label: t("tripsOnLevel"),
            value: progress.trips,
            required: conditions.requiredTrips,
            text: `${progress.trips} / ${conditions.requiredTrips}`,
          },
        ]
      : []),
  ];
}
export function Time({ value }: { value: string | null }) {
  const locale = useLocale(),
    session = useSession(),
    zone = accountTimeZone(session.self?.preferences.displayTimezone);
  return <time dateTime={value ?? undefined}>{formatUtc(value, locale, zone)}</time>;
}
