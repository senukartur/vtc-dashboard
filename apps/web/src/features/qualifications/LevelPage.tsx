import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import {
  failureText,
  historyDiffs,
  LimitList,
  ProgressRow,
  progressRows,
  Time,
  useLocale,
} from "./limits.js";
import { driverName, hasConditions, percent } from "./model.js";
import { levelPath, MineCard } from "./QualificationsPage.js";
import { useQualificationCommand, useQualificationQuery } from "./queries.js";
import {
  type DTO,
  type Game,
  type Level,
  type LevelDetail,
  QualificationFailure,
} from "./transport.js";
import "./qualifications.css";

type Driver = DTO["QualificationLevelDriver"];

/** Q2/Q4: one level with its limits, promotion, drivers and, for leadership, history and actions. */
export function LevelPage() {
  const { t } = useTranslation("qualifications"),
    session = useSession(),
    { levelId = "" } = useParams();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <Card>
        <p>{t("forbidden")}</p>
      </Card>
    );
  return <LevelView key={levelId} levelId={levelId} />;
}
function LevelView({ levelId }: { levelId: string }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    query = useQualificationQuery(
      `/qualification-levels/${encodeURIComponent(levelId)}`,
      "EnvelopeQualificationLevelDetail",
    ),
    level = query.data?.data.data,
    ladderQuery = useQualificationQuery(
      `/qualification-levels?game=${level?.game ?? "ets2"}`,
      "EnvelopeQualificationLevelList",
      !!level,
    ),
    ladder = ladderQuery.data?.data.data.levels ?? [],
    [target, setTarget] = useState<Driver | null>(null),
    [removing, setRemoving] = useState(false),
    promoted = (useLocation().state as { promotedCount?: number } | null)?.promotedCount ?? 0;
  if (query.isPending) return <Card role="status">{t("loading")}</Card>;
  if (!level)
    return (
      <Card className="stack">
        <p role="alert">
          {t(
            query.error instanceof QualificationFailure && query.error.status === 404
              ? "notFound"
              : "loadFailed",
          )}
        </p>
        <div className="qualification-card-actions">
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t("refresh")}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/account/qualifications">{t("back")}</Link>
          </Button>
        </div>
      </Card>
    );
  const own = level.mine?.level?.id === level.id ? level.mine : null;
  return (
    <div className="qualification-workspace stack">
      <nav aria-label={t("breadcrumb")} className="qualification-breadcrumb">
        <Link to={`/account/qualifications?game=${level.game}`}>{t("title")}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{level.name}</span>
      </nav>
      <header className="qualification-header">
        <div className="qualification-title stack">
          <div className="qualification-title-row">
            <Badge tone={level.game}>{level.game.toUpperCase()}</Badge>
            <h1>{level.name}</h1>
          </div>
          <p className="qualification-muted">
            {t("levelOf", { position: level.position, count: level.levelCount })} ·{" "}
            {t("drivers", { count: level.driverCount })}
          </p>
        </div>
        {level.canManage && (
          <div className="qualification-card-actions">
            <Button type="button" variant="outline" onClick={() => setRemoving(true)}>
              {t("remove")}
            </Button>
            <Button asChild>
              <Link to={`${levelPath(level.id)}/edit`}>{t("edit")}</Link>
            </Button>
          </div>
        )}
      </header>
      {promoted > 0 && (
        <p role="status" className="qualification-notice">
          {t("promoted", { count: promoted })}
        </p>
      )}
      {ladder.length > 0 && <Stepper ladder={ladder} current={level.id} game={level.game} />}
      <div className="qualification-detail-grid">
        <Card className="stack">
          <div className="qualification-card-head">
            <h2>{t("limitsTitle")}</h2>
            <InfoTip label={t("limitsTipLabel")} title={t("limitsTitle")}>
              <p>{t("limitsTip1")}</p>
              <p>{t("limitsTip2")}</p>
              <p>{t("limitsTip3")}</p>
            </InfoTip>
          </div>
          <LimitList limits={level.limits} />
        </Card>
        <Card className="stack">
          {level.nextLevel ? (
            <>
              <div className="qualification-card-head">
                <h2>{t("promotionTitle", { name: level.nextLevel.name })}</h2>
                <InfoTip label={t("promotionTipLabel")}>
                  <p>{t("promotionTip1")}</p>
                  <p>{t("promotionTip2")}</p>
                  <p>{t("promotionTip3")}</p>
                </InfoTip>
              </div>
              {hasConditions(level.conditions) ? (
                <dl className="qualification-conditions">
                  {level.conditions.requiredDistanceM !== null && (
                    <div>
                      <dt>{t("distanceOnLevel")}</dt>
                      <dd>{formatQuantity(level.conditions.requiredDistanceM, "km", locale)}</dd>
                    </div>
                  )}
                  {level.conditions.requiredDistanceM !== null &&
                    level.conditions.requiredTrips !== null && (
                      <div aria-hidden="true" className="qualification-muted">
                        {t("and")}
                      </div>
                    )}
                  {level.conditions.requiredTrips !== null && (
                    <div>
                      <dt>{t("tripsOnLevel")}</dt>
                      <dd>{level.conditions.requiredTrips}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="qualification-muted">{t("noConditionsNote")}</p>
              )}
            </>
          ) : (
            <>
              <h2>{t("top")}</h2>
              <p className="qualification-muted">{t("topNote")}</p>
            </>
          )}
          {own && (
            <div className="stack">
              <h3>{t("myProgress")}</h3>
              {level.nextLevel && hasConditions(own.conditions) ? (
                progressRows(t, own.progress, own.conditions, locale).map((row) => (
                  <ProgressRow
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    required={row.required}
                    text={row.text}
                  />
                ))
              ) : (
                <p className="qualification-muted">
                  {t(level.nextLevel ? "progressNone" : "progressTop")}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
      {level.mine && !own && !level.canManage && <MineCard mine={level.mine} game={level.game} />}
      <Drivers level={level} onChange={level.canManage ? setTarget : undefined} />
      {level.canManage && level.history && <History entries={level.history} />}
      {level.canManage && (
        <ChangeDialog
          driver={target}
          level={level}
          ladder={ladder}
          onClose={() => setTarget(null)}
        />
      )}
      {level.canManage && removing && (
        <RemoveDialog level={level} ladder={ladder} onClose={() => setRemoving(false)} />
      )}
    </div>
  );
}
function Stepper({ ladder, current, game }: { ladder: Level[]; current: string; game: Game }) {
  const { t } = useTranslation("qualifications");
  return (
    <nav aria-label={t("ladder", { game: game.toUpperCase() })}>
      <ol className="qualification-stepper">
        {ladder.map((step) => (
          <li key={step.id} data-current={step.id === current ? "true" : undefined}>
            {step.id === current ? (
              <span aria-current="step">{step.name}</span>
            ) : (
              <Link to={levelPath(step.id)}>{step.name}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
function driverPercent(driver: Driver, level: LevelDetail) {
  if (!level.nextLevel || !hasConditions(level.conditions)) return null;
  const shares = [
    level.conditions.requiredDistanceM === null
      ? null
      : percent(driver.credited.distanceM, level.conditions.requiredDistanceM),
    level.conditions.requiredTrips === null
      ? null
      : percent(driver.credited.trips, level.conditions.requiredTrips),
  ].filter((share): share is number => share !== null);
  return shares.length ? Math.floor(Math.min(...shares)) : null;
}
function Drivers({
  level,
  onChange,
}: {
  level: LevelDetail;
  onChange: ((driver: Driver) => void) | undefined;
}) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    headingId = useId();
  const columns: DataTableColumn<Driver>[] = [
    {
      id: "driver",
      header: t("colDriver"),
      rowHeader: true,
      cell: (driver) => (
        <Link to={`/account/drivers/${encodeURIComponent(driver.memberId)}`}>
          {driverName(t, driver)}
        </Link>
      ),
    },
    { id: "since", header: t("colSince"), cell: (driver) => <Time value={driver.since} /> },
    {
      id: "distance",
      header: t("colDistance"),
      align: "end",
      cell: (driver) => formatQuantity(driver.credited.distanceM, "km", locale),
    },
    { id: "trips", header: t("colTrips"), align: "end", cell: (driver) => driver.credited.trips },
    {
      id: "progress",
      header: t("colProgress"),
      align: "end",
      cell: (driver) => {
        const share = driverPercent(driver, level);
        return share === null ? "—" : `${share}%`;
      },
    },
    ...(onChange
      ? [
          {
            id: "actions",
            header: t("colActions"),
            cardLabel: false as const,
            cell: (driver: Driver) => (
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label={t("changeLevelFor", { name: driverName(t, driver) })}
                onClick={() => onChange(driver)}
              >
                {t("changeLevel")}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card className="stack" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("driversTitle")}</h2>
      <DataTable
        caption={t("driversCaption", { name: level.name })}
        columns={columns}
        rows={level.drivers}
        rowKey={(driver) => driver.memberId}
        empty={{ message: t("noDrivers") }}
        size="sm"
      />
      {level.drivers.length >= 1000 && (
        <p className="qualification-muted">{t("driversCapped", { count: 1000 })}</p>
      )}
    </Card>
  );
}
function History({ entries }: { entries: DTO["QualificationLevelHistoryEntry"][] }) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    headingId = useId();
  const changeNames = {
    name: t("changeName"),
    limits: t("changeLimits"),
    conditions: t("changeConditions"),
    position: t("changePosition"),
  };
  const text = (entry: DTO["QualificationLevelHistoryEntry"]) => {
    switch (entry.operation) {
      case "created":
        return t("historyCreated");
      case "edited":
        return entry.changes.length
          ? t("historyEdited", { changes: entry.changes.map((c) => changeNames[c]).join(", ") })
          : t("historyEditedNothing");
      case "moved":
        return t("historyMoved", { position: entry.position ?? "—" });
      case "removed":
        return entry.transferLevel
          ? t("historyRemoved", { name: entry.transferLevel.name })
          : t("historyRemovedUnknown");
      default:
        return t("historyLegacy");
    }
  };
  return (
    <Card className="stack" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("history")}</h2>
      {entries.length ? (
        <ol className="qualification-history">
          {entries.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id; the read-only list is replaced whole on refetch.
            <li key={`${entry.at}:${index}`}>
              <span className="qualification-muted">
                <Time value={entry.at} />
              </span>
              <div>
                {text(entry)}{" "}
                <span className="qualification-muted">
                  · {entry.actor ? entry.actor.displayName : t("system")}
                </span>
                {entry.operation !== "created" && entry.operation !== "removed" && (
                  <HistoryDiff lines={historyDiffs(t, entry.values, locale)} />
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="qualification-muted">{t("historyEmpty")}</p>
      )}
    </Card>
  );
}
function HistoryDiff({ lines }: { lines: ReturnType<typeof historyDiffs> }) {
  const { t } = useTranslation("qualifications");
  if (!lines.length) return null;
  return (
    <ul className="qualification-history-diff">
      {lines.map((line) => (
        <li key={line.label}>
          {t("diffLine", { label: line.label, before: line.from, after: line.to })}
        </li>
      ))}
    </ul>
  );
}
function ChangeDialog({
  driver,
  level,
  ladder,
  onClose,
}: {
  driver: Driver | null;
  level: LevelDetail;
  ladder: Level[];
  onClose: () => void;
}) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand(),
    session = useSession(),
    others = ladder.filter((step) => step.id !== level.id),
    [selected, setSelected] = useState(""),
    [reason, setReason] = useState(""),
    [touched, setTouched] = useState(false),
    levelId = selected || others[0]?.id || "",
    ids = { level: useId(), reason: useId(), error: useId() };
  const close = () => {
    setSelected("");
    setReason("");
    setTouched(false);
    command.reset();
    onClose();
  };
  return (
    <Dialog open={driver !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogTitle>{t("changeTitle", { name: driver ? driverName(t, driver) : "" })}</DialogTitle>
        <DialogDescription>{t("resetNote")}</DialogDescription>
        <form
          className="stack"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setTouched(true);
            if (!driver || !levelId || !reason.trim()) return;
            const result = await command.run(
              "PUT",
              `/admin/members/${driver.memberId}/qualifications/${level.game}`,
              { levelId, reason: reason.trim() },
              "EnvelopeQualificationManualChangeResult",
              () => driver.memberId === session.self?.member.id || level.position === 1,
            );
            if (result) close();
          }}
        >
          <Label htmlFor={ids.level}>{t("newLevel", { game: level.game.toUpperCase() })}</Label>
          <Select id={ids.level} value={levelId} onChange={(e) => setSelected(e.target.value)}>
            {others.map((step) => (
              <option key={step.id} value={step.id}>
                {step.position} · {step.name}
              </option>
            ))}
          </Select>
          <Label htmlFor={ids.reason}>{t("reason")}</Label>
          <textarea
            id={ids.reason}
            className="input qualification-textarea"
            value={reason}
            maxLength={2048}
            required
            aria-invalid={touched && !reason.trim()}
            aria-describedby={touched && !reason.trim() ? ids.error : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
          {touched && !reason.trim() && (
            <p id={ids.error} className="field-error">
              {t("reasonRequired")}
            </p>
          )}
          {command.failure && (
            <p role="alert" className="field-error">
              {failureText(t, command.failure)}
            </p>
          )}
          <div className="qualification-card-actions">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={command.pending || !levelId}>
              {command.pending ? t("saving") : t("move")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function RemoveDialog({
  level,
  ladder,
  onClose,
}: {
  level: LevelDetail;
  ladder: Level[];
  onClose: () => void;
}) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand(),
    navigate = useNavigate(),
    others = ladder.filter((step) => step.id !== level.id),
    [selected, setSelected] = useState(""),
    transferLevelId = selected || others[0]?.id || "",
    id = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("removeTitle", { name: level.name })}</DialogTitle>
        {others.length ? (
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await command.run(
                "POST",
                `/admin/qualification-levels/${level.id}/removal`,
                { expectedVersion: level.version, transferLevelId },
                "EnvelopeQualificationLevelRemovalResult",
                () => level.position === 1 && level.driverCount > 0,
              );
              if (result) navigate(levelPath(result.data.transferLevel.id), { replace: true });
            }}
          >
            <DialogDescription>{t("removeBody", { count: level.driverCount })}</DialogDescription>
            <Label htmlFor={id}>{t("removeTarget")}</Label>
            <Select id={id} value={transferLevelId} onChange={(e) => setSelected(e.target.value)}>
              {others.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.position} · {step.name}
                </option>
              ))}
            </Select>
            <p className="qualification-muted">{t("removeReset")}</p>
            {command.failure && (
              <p role="alert" className="field-error">
                {failureText(t, command.failure)}
              </p>
            )}
            <div className="qualification-card-actions">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={command.pending || !transferLevelId}>
                {command.pending ? t("saving") : t("removeSubmit")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <DialogDescription>{t("removeLast")}</DialogDescription>
            <div className="qualification-card-actions">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("close")}
                </Button>
              </DialogClose>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
