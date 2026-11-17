import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import {
  failureText,
  LimitChips,
  needText,
  ProgressRow,
  progressRows,
  Time,
  useLocale,
} from "./limits.js";
import { hasConditions } from "./model.js";
import { useQualificationCommand, useQualificationQuery } from "./queries.js";
import type { Game, Level, Mine } from "./transport.js";
import "./qualifications.css";

export const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;
export const levelPath = (id: string) => `/account/qualifications/${encodeURIComponent(id)}`;

/** Q1/Q3: the ladder of one game. Without company.read no query mounts, so nothing is requested. */
export function QualificationsPage() {
  const session = useSession(),
    { t } = useTranslation("qualifications"),
    [params, setParams] = useSearchParams(),
    game: Game = params.get("game") === "ats" ? "ats" : "ets2";
  const allowed = !!session.self?.capabilities.includes("company.read");
  return (
    <div className="qualification-workspace stack">
      <header className="qualification-header">
        <div className="qualification-title">
          <h1>{t("title")}</h1>
          <InfoTip label={t("howLabel")} title={t("howTitle")}>
            <p>{t("how1")}</p>
            <p>{t("how2")}</p>
            <p>{t("how3")}</p>
            <p>{t("how4")}</p>
          </InfoTip>
        </div>
        {allowed && (
          <SegmentedControl
            aria-label={t("game")}
            value={game}
            options={games}
            onValueChange={(value) => setParams({ game: value })}
          />
        )}
      </header>
      {allowed ? (
        <Ladder key={game} game={game} />
      ) : (
        <Card>
          <p>{t("forbidden")}</p>
        </Card>
      )}
    </div>
  );
}
function Ladder({ game }: { game: Game }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    query = useQualificationQuery(
      `/qualification-levels?game=${game}`,
      "EnvelopeQualificationLevelList",
    ),
    command = useQualificationCommand(),
    list = query.data?.data.data,
    manage = !!list?.canManage,
    levels = list?.levels ?? [];
  const move = (level: Level, position: number) =>
    void command.run(
      "PUT",
      `/admin/qualification-levels/${level.id}/position`,
      { expectedVersion: level.version, position },
      "EnvelopeQualificationLevelCommandResult",
      (result) => result.data.promotedCount > 0,
    );
  const columns: DataTableColumn<Level>[] = [
    {
      id: "number",
      header: t("colNumber"),
      cell: (level) => level.position,
      className: "qualification-col-number",
      cardLabel: false,
    },
    {
      id: "name",
      header: t("colName"),
      rowHeader: true,
      cell: (level) => (
        <Link to={levelPath(level.id)} className="qualification-level-link">
          {level.name}
        </Link>
      ),
    },
    { id: "limits", header: t("colLimits"), cell: (level) => <LimitChips limits={level.limits} /> },
    {
      id: "next",
      header: t("colNext"),
      cell: (level) =>
        level.nextLevel ? (
          <span className="qualification-next">
            <span aria-hidden="true">→</span> <strong>{level.nextLevel.name}</strong>
            <span className="qualification-muted">{needText(t, level.conditions, locale)}</span>
          </span>
        ) : (
          <span className="qualification-muted">{t("top")}</span>
        ),
    },
    {
      id: "drivers",
      header: t("colDrivers"),
      align: "end",
      cell: (level) => new Intl.NumberFormat(locale).format(level.driverCount),
    },
    ...(manage
      ? [
          {
            id: "order",
            header: t("colOrder"),
            cardLabel: false as const,
            cell: (level: Level) => (
              <span className="qualification-row-actions">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={t("moveUp", { name: level.name })}
                  disabled={command.pending || level.position === 1}
                  onClick={() => move(level, level.position - 1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={t("moveDown", { name: level.name })}
                  disabled={command.pending || level.position === levels.length}
                  onClick={() => move(level, level.position + 1)}
                >
                  ↓
                </Button>
                <Button asChild size="xs" variant="outline">
                  <Link
                    to={`${levelPath(level.id)}/edit`}
                    aria-label={t("editLevel", { name: level.name })}
                  >
                    {t("edit")}
                  </Link>
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      {list?.mine && !manage && <MineCard mine={list.mine} game={game} />}
      <Card className="stack qualification-ladder-card">
        {manage && (
          <div className="qualification-card-actions">
            <Button asChild size="sm">
              <Link to={`/account/qualifications/new?game=${game}`}>{t("add")}</Link>
            </Button>
          </div>
        )}
        {command.failure && (
          <p role="alert" className="field-error">
            {failureText(t, command.failure, levels)}
          </p>
        )}
        <DataTable
          caption={t("levelsCaption", { game: game.toUpperCase() })}
          columns={columns}
          rows={query.data ? levels : undefined}
          rowKey={(level) => level.id}
          rowAttributes={(level) => ({
            ...(list?.mine?.level?.id === level.id ? { "data-current": "true" } : {}),
          })}
          status={query.isPending ? "loading" : query.isError ? "error" : "ready"}
          busy={command.pending}
          error={t("loadFailed")}
          onRetry={() => void query.refetch()}
          empty={{ message: t("emptyLevels") }}
          cardsBelow={800}
        />
      </Card>
      {list?.mine && manage && <MineCard mine={list.mine} game={game} />}
    </>
  );
}
/** "My level" with progress toward the next level's conditions. */
export function MineCard({ mine, game }: { mine: Mine; game: Game }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    headingId = useId();
  if (!mine.level)
    return (
      <Card aria-labelledby={headingId} className="stack qualification-mine">
        <h2 id={headingId}>{t("mine")}</h2>
        <p>{t("noLevel", { game: game.toUpperCase() })}</p>
      </Card>
    );
  const rows = mine.nextLevel ? progressRows(t, mine.progress, mine.conditions, locale) : [];
  return (
    <Card aria-labelledby={headingId} className="stack qualification-mine">
      <div className="qualification-mine-head">
        <h2 id={headingId}>{t("mine")}</h2>
        <InfoTip label={t("progressLabel")}>
          <p>{t("progressTip")}</p>
        </InfoTip>
      </div>
      <p className="qualification-mine-level">
        <Link to={levelPath(mine.level.id)}>{mine.level.name}</Link>
        {mine.since && (
          <span className="qualification-muted">
            {" · "}
            {t("since")} <Time value={mine.since} />
          </span>
        )}
      </p>
      {!mine.nextLevel ? (
        <p className="qualification-muted">{t("progressTop")}</p>
      ) : !hasConditions(mine.conditions) ? (
        <p className="qualification-muted">{t("progressNone")}</p>
      ) : (
        <>
          <p className="qualification-muted">{t("progressNext", { name: mine.nextLevel.name })}</p>
          {rows.map((row) => (
            <ProgressRow
              key={row.key}
              label={row.label}
              value={row.value}
              required={row.required}
              text={row.text}
            />
          ))}
        </>
      )}
    </Card>
  );
}
