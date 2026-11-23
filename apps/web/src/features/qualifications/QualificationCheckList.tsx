import type { TFunction } from "i18next";
import { Check, CircleHelp, Flame, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatQuantity, type Locale } from "../../shared/formatting.js";
import { damageCapText, damagePercentText, rangeText, useLocale } from "./limits.js";
import type { DTO } from "./transport.js";
import "./qualifications.css";

type Rule = DTO["QualificationRuleCheck"];
type T = TFunction<"qualifications">;
const icons = { pass: Check, fail: X, unknown: CircleHelp } as const;
const resultKey = { pass: "resultPass", fail: "resultFail", unknown: "resultUnknown" } as const;
const labels = {
  cargo_mass: "massLabel",
  cargo_damage: "damageLabel",
  distance: "distanceLabel",
  trailer_types: "trailersLabel",
  adr: "adrLabel",
  hard_mode: "hardMode",
} as const;

/** The label, observed value and configured limit of one checked rule; unknown is never zero. */
export function ruleTexts(t: T, rule: Rule, locale: Locale) {
  const unknown = t("observedUnknown");
  switch (rule.rule) {
    case "cargo_mass":
      return {
        label: t(labels.cargo_mass),
        observed: rule.observedKg === null ? unknown : formatQuantity(rule.observedKg, "t", locale),
        limit: rangeText(t, rule.minKg, rule.maxKg, "t", locale),
      };
    case "cargo_damage": {
      const limit = damageCapText(t, rule.maxPercent, locale);
      return {
        label: t(labels.cargo_damage),
        observed:
          rule.observedPercent === null ? unknown : damagePercentText(rule.observedPercent, locale),
        limit: rule.basisLevelName
          ? t("damageLimitLevel", { limit, level: rule.basisLevelName })
          : limit,
      };
    }
    case "distance":
      return {
        label: t(labels.distance),
        observed: rule.observedM === null ? unknown : formatQuantity(rule.observedM, "km", locale),
        limit: rangeText(t, rule.minM, rule.maxM, "km", locale),
      };
    case "trailer_types":
      return {
        label: t(labels.trailer_types),
        observed: rule.observed.length ? rule.observed.map((x) => x.label).join(", ") : unknown,
        limit:
          rule.mode === "any"
            ? t("trailersAny")
            : rule.allowed.map((x) => x.label).join(", ") || t("trailersSelected"),
      };
    case "adr":
      return {
        label: t(labels.adr),
        observed:
          rule.observed === null
            ? unknown
            : rule.observed === "none"
              ? t("adrNone")
              : t(`adr${rule.observed}`),
        limit:
          rule.mode === "forbidden"
            ? t("adrForbidden")
            : rule.mode === "any"
              ? t("adrAny")
              : rule.allowedClasses.join(", ") || t("adrSelected"),
      };
    case "hard_mode":
      return {
        label: t(labels.hard_mode),
        observed:
          rule.observed === "qualified"
            ? t("hardModeQualified")
            : rule.observed === "not-qualified"
              ? t("hardModeNotQualified")
              : unknown,
        limit: t(rule.required ? "hardModeRequired" : "hardModeOptional"),
      };
  }
}
/**
 * The level limits applied to a trip, each with its result, the trip value and the limit.
 * `rulesOnly` leaves out the heading and the level sentence for a caller that shows its own.
 */
export function QualificationCheckList({
  check,
  headingLevel = 2,
  headingId,
  rulesOnly = false,
}: {
  check: DTO["QualificationCheck"];
  headingLevel?: 2 | 3;
  /** Lets the surrounding card or region take its accessible name from the heading. */
  headingId?: string;
  rulesOnly?: boolean;
}) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="qualification-check stack">
      {!rulesOnly && (
        <>
          <Heading id={headingId}>{t("checkTitle")}</Heading>
          <p className="qualification-muted">
            {check.status === "checked"
              ? t("checkChecked", { name: check.level?.name ?? "" })
              : check.status === "event_exempt"
                ? t("checkEventExempt")
                : t("checkNoLevel")}
            {" · "}
            {t(check.basis === "decision" ? "checkBasisDecision" : "checkBasisCurrent")}
          </p>
        </>
      )}
      {check.rules.length > 0 && (
        <ul className="qualification-check-list">
          {check.rules.map((rule) => {
            const text = ruleTexts(t, rule, locale),
              Icon = icons[rule.result];
            return (
              <li key={rule.rule} data-result={rule.result}>
                <Icon
                  size={14}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="qualification-check-symbol"
                />
                <span className="qualification-check-text">
                  <span className="qualification-check-title">
                    {rule.rule === "hard_mode" && (
                      <Flame size={12} strokeWidth={1.8} aria-hidden="true" />
                    )}
                    {text.label}
                    <span className="qualification-muted"> · {t(resultKey[rule.result])}</span>
                  </span>
                  <span className="qualification-muted">
                    {t("observed", { value: text.observed })} · {t("limit", { value: text.limit })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
