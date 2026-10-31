import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";

type OptionsQuery = ReturnType<typeof useWorkspaceQuery<"EnvelopeReinstatementOptions">>;
function LevelLabel({
  game,
  levelId,
  options,
}: {
  game: "ets2" | "ats";
  levelId: string;
  options: OptionsQuery;
}) {
  const { t } = useTranslation("administration");
  const level = options.data?.data.data.levels.find(
    (row) => row.id === levelId && row.game === game,
  );
  return (
    <span>
      {level
        ? `${level.name} · ${t(`qualifications:${level.code}`)}`
        : t(options.isPending ? "levelLabelLoading" : "levelLabelUnavailable")}
    </span>
  );
}

export function IdentityView({ data }: { data: DTO["Identity"] }) {
  const { t } = useTranslation("administration");
  return (
    <dl>
      <dt>{t("steamStatus")}</dt>
      <dd>
        {t(data.steamStatus)}
        {data.steamProfileUrl && (
          <p>
            <a href={data.steamProfileUrl} target="_blank" rel="noreferrer">
              {data.steamProfileUrl}
            </a>
          </p>
        )}
      </dd>
      <dt>{t("truckersStatus")}</dt>
      <dd>
        {t(data.truckersMp.status)}
        {data.truckersMp.found !== null && <p>{t(data.truckersMp.found ? "found" : "notFound")}</p>}
        {data.truckersMp.displayName && <p>{data.truckersMp.displayName}</p>}
      </dd>
      <dt>{t("checkedAt")}</dt>
      <dd>{data.truckersMp.checkedAt ?? t("notSet")}</dd>
      <dt>{t("lastAttempt")}</dt>
      <dd>{data.truckersMp.lastAttemptAt ?? t("notSet")}</dd>
    </dl>
  );
}
function StaffIdentity({ id, version }: { id: string; version: string | null }) {
  const { t } = useTranslation("administration"),
    query = useWorkspaceQuery(`/admin/members/${id}/identity`, "EnvelopeIdentity"),
    [cursor, setCursor] = useState<string | null>(null),
    proofs = useWorkspaceQuery(
      `/admin/members/${id}/steam-replacement-verifications?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListSteamReplacementProof",
    ),
    command = useWorkspaceCommand();
  const [reason, setReason] = useState("");
  const verified =
    proofs.data?.data.data.items.filter(
      (proof) =>
        proof.state === "verified" &&
        Date.parse(proof.expiresAt) > Date.now() &&
        proof.identityEpoch === query.data?.data.data.identityEpoch,
    ) ?? [];
  return (
    <section className="stack">
      <h3>{t("identity")}</h3>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {query.data && <IdentityView data={query.data.data.data} />}
      <h3>{t("replacement")}</h3>
      <QueryState
        pending={proofs.isPending}
        error={proofs.isError}
        retry={proofs.refetch}
        empty={false}
      />
      {proofs.data && !verified.length && <p>{t("noProof")}</p>}
      {verified.length > 0 && (
        <>
          <Label htmlFor="replacement-reason">{t("reason")}</Label>
          <Input
            id="replacement-reason"
            value={reason}
            maxLength={2048}
            disabled={command.held || command.pending}
            onChange={(e) => setReason(e.target.value)}
          />
          {verified.map((proof) => (
            <div className="stack" key={proof.id}>
              <p>{proof.candidateSteamProfileUrl}</p>
              <p>
                {t("expires")}: {proof.expiresAt}
              </p>
              <Confirmation
                label={t("applyReplacement")}
                description={t("replacementHelp")}
                busy={command.pending}
                disabled={command.held || !reason.trim()}
                confirm={async () =>
                  !!(await command.run(
                    `/admin/members/${id}/steam-replacement`,
                    "EnvelopeCommandResult",
                    { verificationId: proof.id, reason },
                    version,
                  ))
                }
              >
                <p className="admin-id">{id}</p>
                <p>{proof.candidateSteamProfileUrl}</p>
                <p>{reason}</p>
              </Confirmation>
            </div>
          ))}
        </>
      )}
      <Pager cursor={cursor} next={proofs.data?.data.data.nextCursor} setCursor={setCursor} />
      <CommandFeedback command={command} />
    </section>
  );
}
function MemberEditor({
  data,
  etag,
  command,
  options,
}: {
  data: DTO["MemberAdmin"];
  etag: string | null;
  command: ReturnType<typeof useWorkspaceCommand>;
  options: OptionsQuery;
}) {
  const { t } = useTranslation("administration");
  const id = data.profile.member.id;
  const [reviewedEtag] = useState(etag);
  const stale = reviewedEtag !== etag;
  const [roles, setRoles] = useState<DTO["RolesInput"]["roles"]>(
      data.profile.member.roles.filter(
        (role): role is DTO["RolesInput"]["roles"][number] => role !== "director",
      ),
    ),
    [reason, setReason] = useState(""),
    [games, setGames] = useState<Record<"ets2" | "ats", string>>({ ets2: "", ats: "" });
  const assignments = (["ets2", "ats"] as const)
    .filter((game) => games[game])
    .map((game) => ({ game, levelId: games[game], purpose: "reinstatement", reason }));
  const busy = command.pending || command.seconds > 0,
    blocked = command.held || busy || stale,
    labelsAvailable = assignments.every((input) =>
      options.data?.data.data.levels.some(
        (level) => level.id === input.levelId && level.game === input.game,
      ),
    );
  return (
    <section className="stack">
      <h3>{t("roles")}</h3>
      {stale && (
        <>
          <p role="alert">{t("errors.conflict")}</p>
          <Button
            variant="outline"
            disabled={command.held || busy}
            onClick={() => void command.refresh(`/admin/members/${id}`)}
          >
            {t("refresh")}
          </Button>
        </>
      )}
      <fieldset disabled={blocked} className="admin-role-list">
        <legend className="sr-only">{t("roles")}</legend>
        {(["trainee", "driver", "dispatcher", "deputy_director"] as const).map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(e) =>
                setRoles((current) =>
                  e.target.checked ? [...current, role] : current.filter((value) => value !== role),
                )
              }
            />
            {t(role)}
          </label>
        ))}
      </fieldset>
      {data.status === "inactive" && (
        <fieldset disabled={blocked} className="stack">
          <legend>{t("qualifications")}</legend>
          {(["ets2", "ats"] as const).map((game) => {
            const levels = options;
            return (
              <div className="stack" key={game}>
                <Label htmlFor={`reinstate-${game}`}>{t(game)}</Label>
                <QueryState
                  pending={levels.isPending}
                  error={levels.isError}
                  retry={levels.refetch}
                />
                <select
                  id={`reinstate-${game}`}
                  className="input"
                  value={games[game]}
                  onChange={(e) => setGames((current) => ({ ...current, [game]: e.target.value }))}
                >
                  <option value="">{t("noGame")}</option>
                  {levels.data?.data.data.levels
                    .filter((level) => level.game === game)
                    .map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.name} · {t(`qualifications:${level.code}`)}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </fieldset>
      )}
      <Label htmlFor="member-reason">{t("reason")}</Label>
      <Input
        id="member-reason"
        value={reason}
        maxLength={2048}
        disabled={blocked}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="admin-actions">
        {data.status === "active" ? (
          <>
            <Confirmation
              label={t("saveRoles")}
              description={t("rolesHelp")}
              busy={busy}
              disabled={command.held || stale || !reason.trim()}
              confirm={async () =>
                !!(await command.run(
                  `/admin/members/${id}/roles`,
                  "EnvelopeCommandResult",
                  { roles, reason },
                  reviewedEtag,
                  "PUT",
                ))
              }
            >
              <p>{data.profile.member.nickname}</p>
              <p>{roles.map((role) => t(role)).join(", ")}</p>
              <p>{reason}</p>
            </Confirmation>
            <Confirmation
              label={t("deactivate")}
              description={t("deactivateHelp")}
              busy={busy}
              disabled={command.held || stale || !reason.trim()}
              confirm={async () =>
                !!(await command.run(
                  `/admin/members/${id}/deactivation`,
                  "EnvelopeCommandResult",
                  { reason },
                  reviewedEtag,
                ))
              }
            >
              <p>{data.profile.member.nickname}</p>
              <p>{reason}</p>
            </Confirmation>
          </>
        ) : (
          <Confirmation
            label={t("reinstate")}
            description={t("reinstateHelp")}
            busy={busy}
            disabled={
              command.held || stale || !reason.trim() || !assignments.length || !labelsAvailable
            }
            confirm={async () =>
              labelsAvailable &&
              !!(await command.run(
                `/admin/members/${id}/reinstatement`,
                "EnvelopeCommandResult",
                { roles, assignments, reason },
                reviewedEtag,
              ))
            }
          >
            <p>{data.profile.member.nickname}</p>
            <p>{roles.map((role) => t(role)).join(", ")}</p>
            {assignments.map((input) => (
              <p key={input.game}>
                {t(input.game)}:{" "}
                <LevelLabel game={input.game} levelId={input.levelId} options={options} />
                <span className="admin-id"> · {input.levelId}</span>
              </p>
            ))}
            <p>{reason}</p>
          </Confirmation>
        )}
      </div>
      {command.held && (
        <Button
          disabled={busy}
          onClick={() =>
            void command.run(`/admin/members/${id}/roles`, "EnvelopeCommandResult", undefined, etag)
          }
        >
          {t("refresh")}
        </Button>
      )}
    </section>
  );
}
function MemberDetail({ id, back }: { id: string; back: () => void }) {
  const { t } = useTranslation("administration"),
    command = useWorkspaceCommand(),
    query = useWorkspaceQuery(`/admin/members/${id}`, "EnvelopeMemberAdmin"),
    options = useWorkspaceQuery("/admin/reinstatement-options", "EnvelopeReinstatementOptions"),
    data = query.data?.data.data,
    director = data?.profile.member.roles.includes("director") ?? false;
  return (
    <Card className="admin-detail stack">
      <Button className="admin-mobile-back" variant="ghost" onClick={back}>
        {t("back")}
      </Button>
      <CommandFeedback command={command} />
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {data && (
        <>
          <h2>{data.profile.member.nickname}</h2>
          <p className="admin-id">{id}</p>
          <Badge>{t(data.status)}</Badge>
          <p>{data.email}</p>
          <p>{data.profile.member.roles.map((role) => t(role)).join(", ")}</p>
          <section className="stack" aria-label={t("qualifications")}>
            <h3>{t("qualifications")}</h3>
            <QueryState
              pending={options.isPending}
              error={options.isError}
              retry={options.refetch}
            />
            {data.profile.qualifications.length ? (
              data.profile.qualifications.map((assignment) => (
                <p key={assignment.id}>
                  {t(assignment.game)} ·{" "}
                  <LevelLabel
                    game={assignment.game}
                    levelId={assignment.levelId}
                    options={options}
                  />{" "}
                  · <span className="admin-id">{assignment.levelId}</span> · {assignment.assignedAt}
                </p>
              ))
            ) : (
              <p>{t("notSet")}</p>
            )}
            <Link to={`/account/qualifications?member=${id}`}>{t("qualificationWorkspace")}</Link>
          </section>
          {director ? (
            <p>{t("protectedDirector")}</p>
          ) : (
            <MemberEditor
              data={data}
              etag={query.data?.etag ?? null}
              command={command}
              options={options}
            />
          )}
          <StaffIdentity
            key={`identity-${data.identityEpoch}`}
            id={id}
            version={query.data?.etag ?? null}
          />
        </>
      )}
    </Card>
  );
}
function Members() {
  const { t } = useTranslation("administration"),
    [search, setSearch] = useSearchParams(),
    [selected, setSelected] = useState<string | null>(null),
    status = search.get("status") === "inactive" ? "inactive" : "active",
    cursor = search.get("cursor");
  const query = useWorkspaceQuery(
    `/admin/members?status=${status}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "EnvelopeListMemberAdmin",
  );
  return (
    <div className="administration-page stack">
      <WorkspaceHeading title={t("members")} />
      <nav className="admin-tabs" aria-label={t("status")}>
        {["active", "inactive"].map((value) => (
          <a
            key={value}
            href={`?status=${value}`}
            aria-current={value === status ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelected(null);
              setSearch({ status: value });
            }}
          >
            {t(value)}
          </a>
        ))}
      </nav>
      <div className={`admin-workbench ${selected ? "has-selection" : ""}`}>
        <Card className="admin-master stack">
          <QueryState
            pending={query.isPending}
            error={query.isError}
            retry={query.refetch}
            empty={query.data?.data.data.items.length === 0}
          />
          <div className="admin-table-scroll">
            <table className="admin-safe-table">
              <thead>
                <tr>
                  <th>{t("nickname")}</th>
                  <th>{t("roles")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.data.data.items.map((row) => (
                  <tr key={row.profile.member.id}>
                    <td>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-pressed={selected === row.profile.member.id}
                        onClick={() => setSelected(row.profile.member.id)}
                      >
                        {row.profile.member.nickname}
                      </Button>
                      <p className="admin-id">{row.profile.member.id}</p>
                    </td>
                    <td>{row.profile.member.roles.map((role) => t(role)).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            cursor={cursor}
            next={query.data?.data.data.nextCursor}
            setCursor={(next) => {
              setSelected(null);
              setSearch({ status, ...(next ? { cursor: next } : {}) });
            }}
          />
        </Card>
        {selected ? (
          <MemberDetail key={selected} id={selected} back={() => setSelected(null)} />
        ) : (
          <Card className="admin-detail">
            <p>{t("select")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
export function MembersPage() {
  return (
    <Permission capability="members.manage">
      <Members />
    </Permission>
  );
}
