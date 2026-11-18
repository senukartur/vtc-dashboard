import { ArrowDown, ArrowRight, ArrowUp, Star } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button, Card } from "../../shared/ui/primitives.js";
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
import { hasConditions, promotionPreview, pushedTop } from "./model.js";
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
    levels = list?.levels ?? [],
    topId = levels.at(-1)?.id,
    // A move that puts a level above the top promotes the top's qualifying drivers at once.
    topQuery = useQualificationQuery(
      `/qualification-levels/${encodeURIComponent(topId ?? "")}`,
      "EnvelopeQualificationLevelDetail",
      manage && levels.length > 1 && !!topId,
    ),
    topDetail = topQuery.data?.data.data,
    [confirming, setConfirming] = useState<{
      level: Level;
      position: number;
      top: Level;
      next: Level;
      count: number | null;
    } | null>(null);
  const apply = (level: Level, position: number) =>
    void command.run(
      "PUT",
      `/admin/qualification-levels/${level.id}/position`,
      { expectedVersion: level.version, position },
      "EnvelopeQualificationLevelCommandResult",
      (result) => result.data.promotedCount > 0,
    );
  const move = (level: Level, position: number) => {
    const pushed = pushedTop(levels, level.id, position);
    const count =
      pushed && topDetail?.id === pushed.top.id
        ? promotionPreview(topDetail.drivers, topDetail.conditions, true)
        : null;
    if (!pushed || count === 0) apply(level, position);
    else setConfirming({ level, position, top: pushed.top, next: pushed.next, count });
  };
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
        <span className="qualification-chips">
          <Link to={levelPath(level.id)} className="qualification-level-link">
            {level.name}
          </Link>
          {list?.mine?.level?.id === level.id && (
            <Badge tone="info" icon={Star}>
              {t("mine")}
            </Badge>
          )}
        </span>
      ),
    },
    { id: "limits", header: t("colLimits"), cell: (level) => <LimitChips limits={level.limits} /> },
    {
      id: "next",
      header: t("colNext"),
      cell: (level) =>
        level.nextLevel ? (
          <span className="qualification-next">
            <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />{" "}
            <strong>{level.nextLevel.name}</strong>
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
                  <ArrowUp size={14} strokeWidth={1.8} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={t("moveDown", { name: level.name })}
                  disabled={command.pending || level.position === levels.length}
                  onClick={() => move(level, level.position + 1)}
                >
                  <ArrowDown size={14} strokeWidth={1.8} aria-hidden="true" />
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
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogTitle>{t("moveConfirmTitle", { name: confirming?.level.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {confirming &&
              (confirming.count === null
                ? t("moveConfirmUnknown", {
                    top: confirming.top.name,
                    next: confirming.next.name,
                  })
                : t("moveConfirm", {
                    count: confirming.count,
                    top: confirming.top.name,
                    next: confirming.next.name,
                  }))}
          </DialogDescription>
          <div className="qualification-card-actions">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={command.pending}
              onClick={() => {
                if (confirming) apply(confirming.level, confirming.position);
                setConfirming(null);
              }}
            >
              {t("moveConfirmSubmit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
