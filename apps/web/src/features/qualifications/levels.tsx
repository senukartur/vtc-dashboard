// biome-ignore-all lint/a11y/noRedundantRoles: explicit table roles survive the phone card layout (display: block/grid), where WebKit drops implicit table semantics.
import { useTranslation } from "react-i18next";
import { formatQuantity, type Locale } from "../../shared/formatting.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import { RuleHistory, RulesView, State } from "./components.js";
import { LevelEditor } from "./editor.js";
import { thresholdSummary } from "./model.js";
import { useQualificationQuery } from "./queries.js";
import type { DTO } from "./transport.js";

type Level = DTO["QualificationLevel"];

export const levelPanelId = (id: string) => `qualification-level-${id}`;

function useRuleDetail(level: Level, enabled: boolean) {
  return useQualificationQuery(
    `/qualification-levels/${level.id}/rule-versions/${level.ruleVersionId}`,
    "EnvelopeQualificationRuleVersion",
    enabled && !!level.ruleVersionId,
  );
}

function useLocale(): Locale {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === "en" ? "en" : "ru";
}

export function LevelsTable({
  levels,
  selectedId,
  editing,
  onSelect,
  headingId,
}: {
  levels: Level[];
  selectedId: string | null;
  editing: ReadonlySet<string>;
  onSelect: (id: string) => void;
  headingId: string;
}) {
  const { t } = useTranslation("qualifications");
  return (
    <Table size="xs" className="qualification-levels" role="table" aria-labelledby={headingId}>
      <thead role="rowgroup">
        <tr role="row">
          {["level", "colMass", "colTrailers", "colAdr", "colThreshold", "version"].map((key) => (
            <th key={key} scope="col" role="columnheader">
              {t(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {levels.map((level, index) => (
          <LevelRow
            key={level.id}
            level={level}
            ordinal={index + 1}
            selected={level.id === selectedId}
            editing={editing.has(level.id)}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </Table>
  );
}

function LevelRow({
  level,
  ordinal,
  selected,
  editing,
  onSelect,
}: {
  level: Level;
  ordinal: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    configured = !!level.ruleVersionId,
    summary = level.freightRuleSummary,
    threshold = thresholdSummary(level),
    distance =
      threshold.kind === "value" && threshold.distanceM !== null
        ? formatQuantity(threshold.distanceM, "km", locale)
        : null;
  const unset = <span className="qualification-muted">{t("unset")}</span>;
  const ruleCell = (render: (value: NonNullable<Level["freightRuleSummary"]>) => string) =>
    !configured ? (
      unset
    ) : summary ? (
      render(summary)
    ) : (
      <span className="qualification-muted">{t("cellUnavailable")}</span>
    );
  const allowlist = (count: number | null) =>
    count === null
      ? t("noRestriction")
      : count === 0
        ? t("noneAllowed")
        : t("allowedCount", { count });
  const label = (key: string) => (
    <span className="qualification-cell-label" aria-hidden="true">
      {t(key)}
    </span>
  );
  return (
    <tr role="row" data-selected={selected ? "" : undefined}>
      <th scope="row" role="rowheader">
        <button
          type="button"
          className="qualification-level-button"
          aria-pressed={selected}
          aria-controls={levelPanelId(level.id)}
          onClick={() => onSelect(level.id)}
        >
          <span className="qualification-ordinal" aria-hidden="true">
            {ordinal}
          </span>
          {level.name}
        </button>
      </th>
      <td role="cell">
        {label("colMass")}
        {ruleCell((value) =>
          value.maxMassKg === null
            ? t("noRestriction")
            : formatQuantity(value.maxMassKg, "t", locale),
        )}
      </td>
      <td role="cell">
        {label("colTrailers")}
        {ruleCell((value) => allowlist(value.allowedTrailerTypeCount))}
      </td>
      <td role="cell">
        {label("colAdr")}
        {ruleCell((value) => allowlist(value.allowedAdrCategoryCount))}
      </td>
      <td role="cell">
        {label("colThreshold")}
        {threshold.kind === "terminal"
          ? t("topLevel")
          : !level.promotionConfigured
            ? unset
            : thresholdText(
                t("thresholdValue", {
                  trips: threshold.trips ?? t("noMinimum"),
                  distance: distance ?? t("noMinimum"),
                }),
                distance,
              )}
      </td>
      <td role="cell">
        {label("version")}
        <span className="qualification-version">
          <span>v{level.version}</span>
          <Badge
            size="xs"
            className={configured ? "badge-accepted" : "qualification-badge-pending"}
          >
            {t(configured ? "statusEffective" : "statusUnpublished")}
          </Badge>
          {editing && (
            <Badge size="xs" className="badge-preview">
              {t("draftOpen")}
            </Badge>
          )}
        </span>
      </td>
    </tr>
  );
}

/**
 * Keep opened panels mounted so their drafts survive row switching. Only selected panels load
 * rules and open rule histories.
 */
export function LevelPanel({
  level,
  manage,
  selected,
  editing,
  onEditingChange,
}: {
  level: Level;
  manage: boolean;
  selected: boolean;
  editing: boolean;
  onEditingChange: (id: string, open: boolean) => void;
}) {
  const { t } = useTranslation("qualifications"),
    rules = useRuleDetail(level, selected),
    headingId = `${levelPanelId(level.id)}-heading`;
  // The heading, rules list and editor stay direct children: e2e journeys scope to them.
  return (
    <Card
      className="stack qualification-level-panel"
      id={levelPanelId(level.id)}
      aria-labelledby={headingId}
      hidden={!selected}
    >
      <h2 id={headingId}>
        {level.name} · {level.game.toUpperCase()}
      </h2>
      <p className="qualification-panel-meta">
        {t("stage")} {level.position}
      </p>
      <p>
        {t("version")}: {level.version}
      </p>
      {level.ruleVersionId ? (
        <>
          <State query={rules} />
          {rules.data && <RulesView rules={rules.data.data.data.rules} game={level.game} />}
        </>
      ) : (
        <p>{t("noRules")}</p>
      )}
      <RuleHistory
        key={`${level.id}:${level.version}`}
        level={level}
        manage={manage}
        visible={selected}
      />
      {manage && (
        <>
          <Button
            type="button"
            variant="outline"
            className="qualification-edit"
            onClick={() => onEditingChange(level.id, !editing)}
            disabled={!editing && !!level.ruleVersionId && !rules.data}
          >
            {t(editing ? "close" : "edit")}
          </Button>
          {editing && <LevelEditor level={level} current={rules.data?.data.data} />}
        </>
      )}
    </Card>
  );
}

/** Only the exact (possibly very long) distance may break anywhere; words wrap normally. */
function thresholdText(text: string, exact: string | null) {
  const index = exact === null ? -1 : text.lastIndexOf(exact);
  if (exact === null || index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <span className="qualification-exact">{exact}</span>
      {text.slice(index + exact.length)}
    </>
  );
}
