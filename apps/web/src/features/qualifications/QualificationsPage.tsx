import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity } from "../../shared/formatting.js";
import { Badge, Card, Label } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { progressPercent } from "../dashboard/model.js";
import { AssignmentEditor } from "./assignments.js";
import { ActionActor, Fact, PageNav, RulesView, State, Time } from "./components.js";
import { LevelPanel, LevelsTable } from "./levels.js";
import { defaultLevelId, sortLevels, unconfiguredCount } from "./model.js";
import { useQualificationQuery } from "./queries.js";
import { type DTO, type Game, QualificationFailure } from "./transport.js";
import "./qualifications.css";

const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;

/** Gate: without company.read no workspace query hook mounts, so nothing is requested. */
export function QualificationsPage() {
  const session = useSession(),
    { t } = useTranslation("qualifications"),
    [params, setParams] = useSearchParams(),
    game: Game = params.get("game") === "ats" ? "ats" : "ets2";
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="qualification-workspace stack">
        <header className="qualification-header">
          <div className="qualification-title">
            <h1>{t("title")}</h1>
          </div>
        </header>
        <Card>
          <p>{t("forbidden")}</p>
        </Card>
      </div>
    );
  const scope = [
    session.generation,
    session.self?.member.id,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
  ].join(":");
  return (
    <div className="qualification-workspace stack">
      <header className="qualification-header">
        <div className="qualification-title">
          <h1>{t("title")}</h1>
          <p className="qualification-intro">{t("intro")}</p>
          <p className="qualification-roles">{t("roles")}</p>
        </div>
        <SegmentedControl
          aria-label={t("game")}
          value={game}
          options={games}
          onValueChange={(value) => setParams({ game: value })}
        />
      </header>
      <Workspace key={`${scope}:${game}`} game={game} />
    </div>
  );
}
function Workspace({ game }: { game: Game }) {
  const session = useSession(),
    { t } = useTranslation("qualifications"),
    manage = !!session.self?.capabilities.includes("qualifications.manage"),
    headingId = useId(),
    [target, setTarget] = useState<DTO["MemberSummary"] | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());
  const levels = useQualificationQuery(
      `/qualification-levels?game=${game}&limit=25`,
      "EnvelopeListQualificationLevel",
    ),
    items = levels.data?.data.data.items ?? [],
    sorted = sortLevels(items),
    // Derived during render: a level missing from the latest list falls back to the first row.
    selectedId = sorted.some((level) => level.id === selected) ? selected : defaultLevelId(sorted),
    missing = unconfiguredCount(sorted);
  const setEditingLevel = (id: string, open: boolean) =>
    setEditing((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <>
      {levels.data && missing > 0 && (
        <div role="status" className="qualification-banner">
          {t("unconfigured", { count: missing, total: sorted.length, game: game.toUpperCase() })}
        </div>
      )}
      <div className="qualification-layout">
        <div className="qualification-main stack">
          <Card className="qualification-levels-card" aria-labelledby={headingId}>
            <h2 id={headingId}>{t("levels")}</h2>
            <State query={levels} />
            {levels.data &&
              (sorted.length ? (
                <LevelsTable
                  levels={sorted}
                  selectedId={selectedId}
                  editing={editing}
                  onSelect={setSelected}
                  headingId={headingId}
                />
              ) : (
                <p>{t("emptyLevels")}</p>
              ))}
          </Card>
          {sorted.map((level) => (
            <LevelPanel
              key={level.id}
              level={level}
              manage={manage}
              selected={level.id === selectedId}
              editing={editing.has(level.id)}
              onEditingChange={setEditingLevel}
            />
          ))}
        </div>
        <div className="qualification-aside stack">
          {manage && (
            <Card className="stack">
              <h2>{t("staff")}</h2>
              <TargetPicker selected={target} onChange={setTarget} />
            </Card>
          )}
          <MemberQualification
            key={target?.id ?? "self"}
            game={game}
            levels={items}
            target={target}
            manage={manage}
          />
        </div>
      </div>
    </>
  );
}
function TargetPicker({
  selected,
  onChange,
}: {
  selected: DTO["MemberSummary"] | null;
  onChange: (member: DTO["MemberSummary"] | null) => void;
}) {
  const { t } = useTranslation("qualifications"),
    [cursors, setCursors] = useState<string[]>([]),
    query = useQualificationQuery(
      `/admin/qualification-members?limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? "")}` : ""}`,
      "EnvelopeListMemberSummary",
    ),
    items = query.data?.data.data.items ?? [];
  const candidates =
    selected && !items.some((m) => m.id === selected.id) ? [selected, ...items] : items;
  const duplicateNames = new Set(
    candidates
      .filter((m, i) => candidates.some((other, j) => i !== j && other.nickname === m.nickname))
      .map((m) => m.nickname),
  );
  const label = (m: DTO["MemberSummary"]) =>
    `${m.nickname}${m.formerMember ? ` · ${t("former")}` : ""}${duplicateNames.has(m.nickname) ? ` · ${m.id}` : ""}`;
  return (
    <div className="stack">
      <Label htmlFor="qualification-member">{t("member")}</Label>
      <select
        id="qualification-member"
        className="input"
        value={selected?.id ?? ""}
        onChange={(e) => {
          const member = items.find((m) => m.id === e.target.value);
          if (!e.target.value || member) onChange(member ?? null);
        }}
      >
        <option value="">{t("own")}</option>
        {selected && !items.some((m) => m.id === selected.id) && (
          <option value={selected.id}>{label(selected)}</option>
        )}
        {items.map((member) => (
          <option key={member.id} value={member.id}>
            {label(member)}
          </option>
        ))}
      </select>
      <State query={query} />
      {query.isSuccess && !items.length && <p>{t("emptyMembers")}</p>}
      {selected && (
        <p>
          {t("selected")}: {selected.nickname} · <code>{selected.id}</code>
        </p>
      )}
      <PageNav
        next={query.data?.data.data.nextCursor}
        hasPrevious={cursors.length > 0}
        onNext={(c) => setCursors((p) => [...p, c])}
        onPrevious={() => setCursors((p) => p.slice(0, -1))}
      />
    </div>
  );
}
function MemberQualification({
  game,
  levels,
  target,
  manage,
}: {
  game: Game;
  levels: DTO["QualificationLevel"][];
  target: DTO["MemberSummary"] | null;
  manage: boolean;
}) {
  const { t, i18n } = useTranslation("qualifications"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    session = useSession(),
    id = target?.id ?? session.self?.member.id ?? "",
    base = manage ? `/admin/members/${id}` : "/me",
    [cursors, setCursors] = useState<string[]>([]);
  const progress = useQualificationQuery(
      `${base}/qualification-progress?game=${game}`,
      "EnvelopeProgress",
    ),
    history = useQualificationQuery(
      `${base}/${manage ? "qualification-action-history" : "qualification-assignments"}?game=${game}&limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? "")}` : ""}`,
      manage ? "EnvelopeListQualificationActionHistory" : "EnvelopeListAssignmentHistory",
    ),
    p = progress.data?.data.data,
    level = levels.find((l) => l.id === p?.assignment.levelId),
    missing =
      levels.length > 0 &&
      progress.error instanceof QualificationFailure &&
      progress.error.setupRequired;
  const currentRules = useQualificationQuery(
    `/qualification-levels/${level?.id}/rule-versions/${level?.ruleVersionId}`,
    "EnvelopeQualificationRuleVersion",
    !!level?.ruleVersionId,
  );
  return (
    <>
      <Card className="stack">
        <h2>
          {t("current")} · {game.toUpperCase()}
        </h2>
        {target && (
          <p>
            {target.nickname} {target.formerMember ? `· ${t("former")}` : ""}
          </p>
        )}
        {missing ? <p>{t("noAssignment")}</p> : <State query={progress} />}{" "}
        {p && (
          <>
            <h3>{level?.name ?? p.assignment.levelId}</h3>
            <p>
              {t("currentInterval")}: <Time value={p.assignment.assignedAt} />
            </p>
            {p.reviewRequired && (
              <div role="alert" className="qualification-callout">
                <strong>{t("decisionNeeded")}</strong>
                <p>{t("review")}</p>
                <p>{t("levelKept")}</p>
              </div>
            )}
            <div className="qualification-progress-heading">
              <h3>{t("progress")}</h3>
              {p.eligibleForConfirmation && level?.code !== "driver_i" && (
                <Badge size="xs" className="badge-accepted">
                  {t("ready")}
                </Badge>
              )}
            </div>
            <dl className="qualification-facts qualification-progress">
              <Fact label={t("trips")}>
                <ProgressValue
                  percent={progressPercent(
                    String(p.acceptedTrips),
                    p.requiredTrips === null ? null : String(p.requiredTrips),
                  )}
                >
                  {p.acceptedTrips} / {p.requiredTrips ?? t("unset")}
                </ProgressValue>
              </Fact>
              <Fact label={t("distance")}>
                <ProgressValue percent={progressPercent(p.actualDistanceM, p.requiredDistanceM)}>
                  {formatQuantity(p.actualDistanceM, "km", locale)} /{" "}
                  {p.requiredDistanceM === null
                    ? t("unset")
                    : formatQuantity(p.requiredDistanceM, "km", locale)}
                </ProgressValue>
              </Fact>
            </dl>
            <p>
              {t(
                level?.code === "driver_i"
                  ? "terminal"
                  : p.eligibleForConfirmation
                    ? "eligible"
                    : "ineligible",
              )}
            </p>
            <h3>{t("restrictions")}</h3>
            {level?.ruleVersionId ? (
              <>
                <State query={currentRules} />
                {currentRules.data && (
                  <RulesView rules={currentRules.data.data.data.rules} game={game} />
                )}
              </>
            ) : (
              <p>{t("noRules")}</p>
            )}
          </>
        )}
      </Card>
      {manage && (
        <AssignmentEditor
          game={game}
          memberId={id}
          memberName={target?.nickname ?? session.self?.member.nickname ?? t("own")}
          levels={levels}
          progress={p}
          etag={progress.data?.etag ?? history.data?.etag ?? null}
          former={target?.formerMember ?? false}
          onRefresh={() => setCursors([])}
        />
      )}
      <Card className="stack">
        <h2>{t("history")}</h2>
        <p>{t(manage ? "staffHistoryHelp" : "immutable")}</p>
        <State
          query={history}
          refresh={() => {
            setCursors([]);
            if (!cursors.length) return history.refetch();
          }}
        />
        {history.data && history.data.data.data.items.length === 0 && <p>{t("emptyHistory")}</p>}
        {history.data?.data.data.items.map((a) => (
          <article className="qualification-history" key={a.id}>
            <strong>{levels.find((l) => l.id === a.levelId)?.name ?? a.levelId}</strong>
            {manage && "purpose" in a && (
              <>
                <p>
                  {t("purpose")}: {t(a.purpose)}
                </p>
                <p>
                  {t("actor")}: <ActionActor actor={a.actor} />
                </p>
                {a.promotion && (
                  <p>
                    {t("promotionConfirmed")}: <Time value={a.promotion.confirmedAt} /> ·{" "}
                    <code>{a.promotion.id}</code>
                  </p>
                )}
              </>
            )}
            <p>
              {manage && `${t("effectiveInterval")}: `}
              <Time value={a.assignedAt} /> →{" "}
              {a.endedAt ? (
                <>
                  <Time value={a.endedAt} /> ({t("exclusive")})
                </>
              ) : (
                t("currentInterval")
              )}
            </p>
            <small>
              {t("assignmentId")}: <code>{a.id}</code>
            </small>
          </article>
        ))}
        <PageNav
          next={history.data?.data.data.nextCursor}
          hasPrevious={cursors.length > 0}
          onNext={(c) => setCursors((prev) => [...prev, c])}
          onPrevious={() => setCursors((prev) => prev.slice(0, -1))}
        />
      </Card>
    </>
  );
}
/** Exact value text with a decorative bar; no bar when the requirement is unset. */
function ProgressValue({ percent, children }: { percent: number | null; children: ReactNode }) {
  return (
    <>
      <span className="qualification-progress-value">{children}</span>
      {percent !== null && (
        <span className="qualification-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
    </>
  );
}
