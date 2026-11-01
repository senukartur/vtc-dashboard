import { useTranslation } from "react-i18next";
import { formatQuantity, type Locale } from "../../shared/formatting.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import { RuleHistory, RulesView, State } from "./components.js";
import { LevelEditor } from "./editor.js";
import { type AllowlistSummary, ruleSummary, type RuleSummary, thresholdSummary } from "./model.js";
import { useQualificationQuery } from "./queries.js";
import type { DTO } from "./transport.js";

type Level = DTO["QualificationLevel"];

export const levelPanelId = (id: string) => `qualification-level-${id}`;

/** The table and the panels read the exact same immutable detail query, so no GET is added. */
function useRuleDetail(level: Level) {
  return useQualificationQuery(
    `/qualification-levels/${level.id}/rule-versions/${level.ruleVersionId}`,
    "EnvelopeQualificationRuleVersion",
    !!level.ruleVersionId,
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
    <Table size="xs" className="qualification-levels" aria-labelledby={headingId}>
      <thead>
        <tr>
          <th scope="col">{t("level")}</th>
          <th scope="col">{t("colMass")}</th>
          <th scope="col">{t("colTrailers")}</th>
          <th scope="col">{t("colAdr")}</th>
          <th scope="col">{t("colThreshold")}</th>
          <th scope="col">{t("version")}</th>
        </tr>
      </thead>
      <tbody>
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
    rules = useRuleDetail(level),
    configured = !!level.ruleVersionId,
    summary = rules.data ? ruleSummary(rules.data.data.data.rules) : null,
    threshold = thresholdSummary(level);
  const unset = <span className="qualification-muted">{t("unset")}</span>;
  // A disabled query also reports pending, so unconfigured levels are handled before loading.
  const ruleCell = (render: (value: RuleSummary) => string) =>
    !configured ? (
      unset
    ) : summary ? (
      render(summary)
    ) : (
      <span className="qualification-muted">
        {t(rules.isError ? "cellUnavailable" : "cellLoading")}
      </span>
    );
  const allowlist = (value: AllowlistSummary) =>
    value.kind === "none"
      ? t("noRestriction")
      : value.kind === "empty"
        ? t("noneAllowed")
        : t("allowedCount", { count: value.count });
  const label = (key: string) => (
    <span className="qualification-cell-label" aria-hidden="true">
      {t(key)}
    </span>
  );
  return (
    <tr data-selected={selected ? "" : undefined}>
      <th scope="row">
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
      <td>
        {label("colMass")}
        {ruleCell((value) =>
          value.mass.kind === "none"
            ? t("noRestriction")
            : formatQuantity(value.mass.maxKg, "t", locale),
        )}
      </td>
      <td>
        {label("colTrailers")}
        {ruleCell((value) => allowlist(value.trailers))}
      </td>
      <td>
        {label("colAdr")}
        {ruleCell((value) => allowlist(value.adr))}
      </td>
      <td>
        {label("colThreshold")}
        {threshold.kind === "terminal"
          ? t("topLevel")
          : !configured || (threshold.trips === null && threshold.distanceM === null)
            ? unset
            : t("thresholdValue", {
                trips: threshold.trips ?? t("unset"),
                distance:
                  threshold.distanceM === null
                    ? t("unset")
                    : formatQuantity(threshold.distanceM, "km", locale),
              })}
      </td>
      <td>
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
 * One level's detail and editor. Every panel stays mounted and only the selected one is shown, so
 * open drafts, rule history and their queries survive row switching.
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
    rules = useRuleDetail(level),
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
        {t("stage")}: {t(level.code)}
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
      <RuleHistory key={`${level.id}:${level.version}`} level={level} manage={manage} />
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
