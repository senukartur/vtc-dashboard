import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import { AssignmentEditor } from "./assignments.js";
import { ActionActor, Fact, PageNav, RuleHistory, RulesView, State, Time } from "./components.js";
import { LevelEditor } from "./editor.js";
import { useQualificationQuery } from "./queries.js";
import { type DTO, type Game, levelOrder, QualificationFailure } from "./transport.js";
import "./qualifications.css";

export function QualificationsPage() {
  const session = useSession(),
    { t } = useTranslation("qualifications"),
    [params, setParams] = useSearchParams(),
    game: Game = params.get("game") === "ats" ? "ats" : "ets2";
  const scope = [
    session.generation,
    session.self?.member.id,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
  ].join(":");
  return (
    <div className="qualification-workspace stack">
      <header>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
        <p>{t("roles")}</p>
      </header>
      <div>
        <Label htmlFor="qualification-game">{t("game")}</Label>
        <select
          className="input"
          id="qualification-game"
          value={game}
          onChange={(e) => setParams({ game: e.target.value })}
        >
          <option value="ets2">ETS2</option>
          <option value="ats">ATS</option>
        </select>
      </div>
      <Workspace key={`${scope}:${game}`} game={game} />
    </div>
  );
}
function Workspace({ game }: { game: Game }) {
  const session = useSession(),
    { t } = useTranslation("qualifications"),
    manage = !!session.self?.capabilities.includes("qualifications.manage"),
    [target, setTarget] = useState<DTO["MemberSummary"] | null>(null);
  const levels = useQualificationQuery(
      `/qualification-levels?game=${game}&limit=25`,
      "EnvelopeListQualificationLevel",
    ),
    items = levels.data?.data.data.items ?? [];
  return (
    <>
      <State query={levels} />
      <MemberQualification
        key={target?.id ?? "self"}
        game={game}
        levels={items}
        target={target}
        manage={manage}
      />
      {manage && (
        <Card className="stack">
          <h2>{t("staff")}</h2>
          <TargetPicker selected={target} onChange={setTarget} />
        </Card>
      )}
      <section className="stack">
        <h2>{t("levels")}</h2>
        {[...items]
          .sort((a, b) => levelOrder.indexOf(a.code) - levelOrder.indexOf(b.code))
          .map((level) => (
            <Level key={level.id} level={level} manage={manage} />
          ))}
      </section>
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
  const { t } = useTranslation("qualifications"),
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
            {p.reviewRequired && <p role="alert">{t("review")}</p>}
            <h3>{t("progress")}</h3>
            <dl className="qualification-facts">
              <Fact label={t("trips")}>
                {p.acceptedTrips} / {p.requiredTrips ?? t("unset")}
              </Fact>
              <Fact label={t("distance")}>
                {p.actualDistanceM} / {p.requiredDistanceM ?? t("unset")}
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
              {a.endedAt ? <Time value={a.endedAt} /> : t("currentInterval")}
            </p>
            <small>
              {t("exclusive")} · <code>{a.id}</code>
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
      {manage && (
        <AssignmentEditor
          game={game}
          memberId={id}
          memberName={target?.nickname ?? session.self?.member.nickname ?? t("own")}
          levels={levels}
          progress={p}
          etag={progress.data?.etag ?? history.data?.etag ?? null}
          former={target?.formerMember ?? false}
        />
      )}
    </>
  );
}
function Level({ level, manage }: { level: DTO["QualificationLevel"]; manage: boolean }) {
  const { t } = useTranslation("qualifications"),
    [edit, setEdit] = useState(false),
    rules = useQualificationQuery(
      `/qualification-levels/${level.id}/rule-versions/${level.ruleVersionId}`,
      "EnvelopeQualificationRuleVersion",
      !!level.ruleVersionId,
    );
  return (
    <Card className="stack">
      <h3>
        {level.name} · {level.game.toUpperCase()}
      </h3>
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
          <Button type="button" variant="outline" onClick={() => setEdit(!edit)}>
            {t(edit ? "close" : "edit")}
          </Button>
          {edit && (!level.ruleVersionId || rules.data) && (
            <LevelEditor level={level} current={rules.data?.data.data} />
          )}
        </>
      )}
    </Card>
  );
}
