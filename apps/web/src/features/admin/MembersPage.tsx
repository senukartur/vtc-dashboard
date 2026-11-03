import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Button, Card, Input, Label, Table } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import {
  type Additional,
  additionalOf,
  additionalRoles,
  type Filters,
  filterParams,
  formatDay,
  type Game,
  games,
  type LevelCell,
  lastTrip,
  levelCell,
  listPath,
  type Membership,
  memberPanel,
  membershipChange,
  membershipOf,
  orderedRoles,
  parseFilters,
  type Role,
  type RoleFilter,
  reinstatementBody,
  roleDiff,
  roleFilters,
  rolesBody,
  normalizeSearch,
  searchMaxLength,
} from "./members-model.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";
import "./members.css";

type Command = ReturnType<typeof useWorkspaceCommand>;
type OptionsQuery = ReturnType<typeof useWorkspaceQuery<"EnvelopeReinstatementOptions">>;
/** Focus the detail heading once the detail has been read again after `at`. */
type FocusRequest = { at: number; force: boolean };

/** Dates use the member's display timezone; the list footnote names it. */
function useDates() {
  const { i18n } = useTranslation("administration"),
    session = useSession();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  return {
    timezone,
    day: (value: string) => formatDay(value, locale, timezone),
    time: (value: string | null) => formatUtc(value, locale, timezone),
  };
}
function LevelLabel({
  game,
  levelId,
  options,
}: {
  game: Game;
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
function StatusBadge({ status }: { status: "active" | "inactive" }) {
  const { t } = useTranslation("administration");
  return (
    <Badge size="xs" className={`members-status members-status-${status}`}>
      <span aria-hidden="true">{status === "active" ? "●" : "◇"}</span>
      {t(`membersUi.status.${status}`)}
    </Badge>
  );
}
function RoleBadges({ roles }: { roles: Role[] }) {
  const { t } = useTranslation("administration"),
    ordered = orderedRoles(roles);
  return ordered.length ? (
    <span className="members-role-badges">
      {ordered.map((role) => (
        <Badge key={role} size="xs" className={`members-role members-role-${role}`}>
          {t(`membersUi.roleShort.${role}`)}
        </Badge>
      ))}
    </span>
  ) : (
    <Absent label="membersUi.noRoles" />
  );
}
/** A visible dash with a spoken explanation. */
function Absent({ label }: { label: "membersUi.noRoles" | "membersUi.noQualification" }) {
  const { t } = useTranslation("administration");
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{t(label)}</span>
    </>
  );
}
function LevelText({ cell }: { cell: LevelCell }) {
  const { t } = useTranslation("administration");
  if (cell === "none") return <Absent label="membersUi.noQualification" />;
  if (cell === "loading")
    return (
      <>
        <span aria-hidden="true">…</span>
        <span className="visually-hidden">{t("membersUi.levelLoading")}</span>
      </>
    );
  // Two short words fit the narrow level columns; the spoken text says the label read failed.
  if (cell === "unavailable")
    return (
      <>
        <span aria-hidden="true">{t("membersUi.levelNoLabel")}</span>
        <span className="visually-hidden">{t("levelLabelUnavailable")}</span>
      </>
    );
  return <>{cell.name}</>;
}
function ReasonField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("administration");
  return (
    <div className="members-field">
      <Label htmlFor={id}>{t("reason")}</Label>
      <textarea
        id={id}
        className="input"
        rows={3}
        maxLength={2048}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className="muted">
        {t("membersUi.reasonHelp")}
      </p>
    </div>
  );
}
function Points({ items }: { items: string[] }) {
  return (
    <ul className="members-points">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
/**
 * Resends the held (uncertain) attempt with its frozen target, body, key and version. It stays
 * focusable while busy (aria-disabled with a guard), so focus survives a retry that fails again.
 */
function HeldRetry({
  retry,
  busy,
  onRetry,
}: {
  retry: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation("administration");
  return (
    <Button
      ref={retry}
      className="members-retry"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onRetry();
      }}
    >
      {t("membersUi.retrySame")}
    </Button>
  );
}
function IdentityFacts({ data }: { data: DTO["Identity"] }) {
  const { t } = useTranslation("administration"),
    dates = useDates();
  return (
    <dl className="members-facts">
      <div>
        <dt>{t("steamStatus")}</dt>
        <dd>
          {t(data.steamStatus)}
          {data.steamProfileUrl && (
            <>
              {" "}
              <a
                className="members-break"
                href={data.steamProfileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {data.steamProfileUrl}
              </a>
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>{t("truckersStatus")}</dt>
        <dd>
          {t(data.truckersMp.status)}
          {data.truckersMp.found !== null &&
            ` · ${t(data.truckersMp.found ? "found" : "notFound")}`}
          {data.truckersMp.displayName && (
            <span className="members-break"> · {data.truckersMp.displayName}</span>
          )}
        </dd>
      </div>
      <div>
        <dt>{t("checkedAt")}</dt>
        <dd>{data.truckersMp.checkedAt ? dates.time(data.truckersMp.checkedAt) : t("notSet")}</dd>
      </div>
    </dl>
  );
}
function SteamReplacement({
  id,
  version,
  nickname,
  heading,
  committed,
}: {
  id: string;
  version: string | null;
  nickname: string;
  heading: RefObject<HTMLHeadingElement | null>;
  committed: (at: number) => void;
}) {
  const { t } = useTranslation("administration"),
    dates = useDates(),
    query = useWorkspaceQuery(`/admin/members/${id}/identity`, "EnvelopeIdentity"),
    [cursor, setCursor] = useState<string | null>(null),
    proofs = useWorkspaceQuery(
      `/admin/members/${id}/steam-replacement-verifications?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListSteamReplacementProof",
    ),
    command = useWorkspaceCommand(),
    retry = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const verified =
    proofs.data?.data.data.items.filter(
      (proof) =>
        proof.state === "verified" &&
        Date.parse(proof.expiresAt) > Date.now() &&
        proof.identityEpoch === query.data?.data.data.identityEpoch,
    ) ?? [];
  async function apply(verificationId: string) {
    const at = Date.now();
    const done = !!(await command.run(
      `/admin/members/${id}/steam-replacement`,
      "EnvelopeCommandResult",
      { verificationId, reason },
      version,
    ));
    if (done) committed(at);
    return done;
  }
  return (
    <section className="stack members-section members-steam" aria-labelledby="members-steam-title">
      <h3 id="members-steam-title">{t("membersUi.steamTitle")}</h3>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {query.data && <IdentityFacts data={query.data.data.data} />}
      <QueryState
        pending={proofs.isPending}
        error={proofs.isError}
        retry={proofs.refetch}
        empty={false}
      />
      {proofs.data && !verified.length && <p className="muted">{t("noProof")}</p>}
      {verified.map((proof) => (
        <div className="members-proof" key={proof.id}>
          <p className="muted">{t("membersUi.candidate")}</p>
          <p className="members-break">{proof.candidateSteamProfileUrl ?? t("notSet")}</p>
          <p className="muted">
            {[
              proof.verifiedAt
                ? t("membersUi.proofVerified", { date: dates.time(proof.verifiedAt) })
                : null,
              t("membersUi.proofExpires", { date: dates.time(proof.expiresAt) }),
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
          <div className="admin-actions">
            <Confirmation
              label={t("membersUi.applyReplacement")}
              title={t("membersUi.replacementDialog", { nickname })}
              description={t("membersUi.replacementDescription")}
              busy={command.pending}
              disabled={command.held}
              confirmDisabled={!reason.trim() || command.held}
              restoreFocus={() => retry.current ?? heading.current}
              confirm={() => apply(proof.id)}
            >
              <div className="members-dialog">
                <p className="members-break">{proof.candidateSteamProfileUrl ?? t("notSet")}</p>
                <Points
                  items={[
                    t("membersUi.replacementTokens"),
                    t("membersUi.replacementTrips"),
                    t("membersUi.replacementAudit"),
                  ]}
                />
                <ReasonField
                  id={`members-steam-reason-${proof.id}`}
                  value={reason}
                  disabled={command.pending || command.held}
                  onChange={setReason}
                />
              </div>
            </Confirmation>
          </div>
        </div>
      ))}
      <Pager cursor={cursor} next={proofs.data?.data.data.nextCursor} setCursor={setCursor} />
      <CommandFeedback command={command} />
      {command.held && (
        <HeldRetry
          retry={retry}
          busy={command.pending || command.seconds > 0}
          onRetry={() => {
            const at = Date.now();
            void command
              .run(
                `/admin/members/${id}/steam-replacement`,
                "EnvelopeCommandResult",
                undefined,
                version,
              )
              .then((result) => {
                if (result) committed(at);
              });
          }}
        />
      )}
    </section>
  );
}
function MembershipRadios({
  name,
  value,
  onChange,
  describedBy,
  radios,
}: {
  name: string;
  value: Membership | null;
  onChange?: (value: Membership) => void;
  describedBy?: string;
  radios?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation("administration");
  return (
    <div ref={radios} className="members-options">
      {(["trainee", "driver"] as const).map((option) => (
        <label key={option} className="members-option">
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            aria-describedby={describedBy}
            onChange={() => onChange?.(option)}
          />
          {t(option)}
        </label>
      ))}
    </div>
  );
}
function AdditionalChecks({
  idPrefix,
  value,
  onChange,
  describedBy,
  checks,
}: {
  idPrefix: string;
  value: Additional[];
  onChange?: (value: Additional[]) => void;
  describedBy?: string;
  checks?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation("administration");
  const help = {
    dispatcher: "membersUi.dispatcherHelp",
    deputy_director: "membersUi.deputyHelp",
  } as const;
  return (
    <div ref={checks} className="members-options members-options-column">
      {additionalRoles.map((role) => (
        <div key={role} className="members-check">
          <label className="members-option" htmlFor={`${idPrefix}-${role}`}>
            <input
              id={`${idPrefix}-${role}`}
              type="checkbox"
              checked={value.includes(role)}
              aria-describedby={[`${idPrefix}-${role}-help`, describedBy].filter(Boolean).join(" ")}
              onChange={(e) =>
                onChange?.(
                  e.target.checked
                    ? additionalRoles.filter((item) => item === role || value.includes(item))
                    : value.filter((item) => item !== role),
                )
              }
            />
            {t(role)}
          </label>
          <p id={`${idPrefix}-${role}-help`} className="muted">
            {t(help[role])}
          </p>
        </div>
      ))}
    </div>
  );
}
/** The serving Director: current membership and roles shown read-only, deactivation unavailable. */
function ProtectedPanel({ roles, steam }: { roles: Role[]; steam: ReactNode }) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    current = membershipOf(roles);
  return (
    <>
      <section
        className="stack members-section members-roles"
        aria-labelledby="members-roles-title"
      >
        <h3 id="members-roles-title">{t("membersUi.rolesTitle")}</h3>
        <div className="members-protected stack">
          <p className="members-protected-title">{t("membersUi.protectedTitle")}</p>
          <p id="members-protected-note">{t("membersUi.protectedNote")}</p>
          {session.self?.capabilities.includes("leadership.transfer") && (
            <Link to="/account/admin/settings">{t("membersUi.transferLink")}</Link>
          )}
        </div>
        <fieldset disabled className="members-group">
          <legend>{t("membersUi.membership")}</legend>
          <MembershipRadios
            name="members-protected-membership"
            value={current === "trainee" || current === "driver" ? current : null}
            describedBy="members-protected-note"
          />
        </fieldset>
        <fieldset disabled className="members-group">
          <legend>{t("membersUi.additional")}</legend>
          <AdditionalChecks
            idPrefix="members-protected"
            value={additionalOf(roles)}
            describedBy="members-protected-note"
          />
        </fieldset>
      </section>
      {steam}
      <section
        className="stack members-section members-leave"
        aria-labelledby="members-leave-title"
      >
        <h3 id="members-leave-title">{t("membersUi.leaveTitle")}</h3>
        <p className="muted">{t("membersUi.leaveHelp")}</p>
        <div className="admin-actions">
          <Button
            variant="outline"
            className="members-danger"
            disabled
            aria-describedby="members-protected-note"
          >
            {t("membersUi.deactivate")}
          </Button>
        </div>
      </section>
    </>
  );
}
type Reasons = Record<"membership" | "roles" | "deactivate" | "restore", string>;
/**
 * Membership, roles, deactivation and restore of a non-protected member. One command serves all
 * four; the version reviewed when this panel mounted is sent as If-Match, and a newer read marks
 * the panel stale until it is refreshed.
 */
function MemberPanel({
  data,
  etag,
  command,
  options,
  steam,
  heading,
  retry,
  requestFocus,
}: {
  data: DTO["MemberAdmin"];
  etag: string | null;
  command: Command;
  options: OptionsQuery;
  steam: ReactNode;
  heading: RefObject<HTMLHeadingElement | null>;
  retry: RefObject<HTMLButtonElement | null>;
  requestFocus: (at: number, force: boolean) => void;
}) {
  const { t } = useTranslation("administration");
  const id = data.profile.member.id,
    nickname = data.profile.member.nickname,
    roles = data.profile.member.roles,
    panel = memberPanel({ roles, status: data.status }),
    current = membershipOf(roles);
  const [reviewedEtag] = useState(etag);
  const stale = reviewedEtag !== etag;
  const [membership, setMembership] = useState<Membership | null>(
      current === "trainee" || current === "driver" ? current : null,
    ),
    [additional, setAdditional] = useState<Additional[]>(additionalOf(roles)),
    [reasons, setReasons] = useState<Reasons>({
      membership: "",
      roles: "",
      deactivate: "",
      restore: "",
    }),
    [restoreMembership, setRestoreMembership] = useState<Membership>("trainee"),
    [restoreAdditional, setRestoreAdditional] = useState<Additional[]>([]),
    [levels, setLevels] = useState<Record<Game, string>>({ ets2: "", ats: "" });
  const radios = useRef<HTMLDivElement>(null),
    checks = useRef<HTMLDivElement>(null);
  const busy = command.pending || command.seconds > 0,
    blocked = command.held || busy || stale,
    change = membershipChange(roles, membership),
    diff = roleDiff(roles, additional),
    rolesChanged = diff.added.length + diff.removed.length > 0,
    restoreFocus = () => retry.current ?? heading.current;
  const reason = (key: keyof Reasons) => ({
    value: reasons[key],
    // A held attempt resends its frozen body, so the sent reason stays visible and fixed.
    disabled: busy || command.held,
    onChange: (value: string) => setReasons((previous) => ({ ...previous, [key]: value })),
  });
  /** Runs one member command and asks for the heading once the detail was read again. */
  async function submit(path: string, body: unknown, method = "POST") {
    const at = Date.now();
    const done = !!(await command.run(path, "EnvelopeCommandResult", body, reviewedEtag, method));
    requestFocus(at, done);
    return done;
  }
  const restore = reinstatementBody(restoreMembership, restoreAdditional, levels, reasons.restore),
    labelsAvailable = restore.assignments.every((input) =>
      options.data?.data.data.levels.some(
        (level) => level.id === input.levelId && level.game === input.game,
      ),
    );
  const membershipLabel = (value: string) =>
    value === "none" || value === "both" ? t(`membersUi.membershipFrom.${value}`) : t(value);
  const staleAlert = stale && (
    <div className="stack members-stale">
      <p role="alert">{t("errors.conflict")}</p>
      <Button
        variant="outline"
        disabled={command.held || busy}
        onClick={() => {
          const at = Date.now();
          void command.refresh(`/admin/members/${id}`).then(() => requestFocus(at, false));
        }}
      >
        {t("refresh")}
      </Button>
    </div>
  );
  if (panel.restore)
    return (
      <>
        {steam}
        <section
          className="stack members-section members-restore"
          aria-labelledby="members-restore-title"
        >
          <h3 id="members-restore-title">{t("membersUi.restoreTitle")}</h3>
          <p className="muted">{t("membersUi.restoreHelp")}</p>
          {staleAlert}
          <fieldset disabled={blocked} className="members-group">
            <legend>{t("membersUi.membership")}</legend>
            <MembershipRadios
              name="members-restore-membership"
              value={restoreMembership}
              onChange={setRestoreMembership}
            />
          </fieldset>
          <fieldset disabled={blocked} className="members-group">
            <legend>{t("membersUi.additional")}</legend>
            <AdditionalChecks
              idPrefix="members-restore"
              value={restoreAdditional}
              onChange={setRestoreAdditional}
            />
          </fieldset>
          <fieldset disabled={blocked} className="members-group members-levels">
            <legend>{t("qualifications")}</legend>
            <QueryState
              pending={options.isPending}
              error={options.isError}
              retry={options.refetch}
            />
            {games.map((game) => (
              <div className="members-field" key={game}>
                <Label htmlFor={`reinstate-${game}`}>{t(game)}</Label>
                <select
                  id={`reinstate-${game}`}
                  className="input"
                  value={levels[game]}
                  onChange={(e) =>
                    setLevels((previous) => ({ ...previous, [game]: e.target.value }))
                  }
                >
                  <option value="">{t("noGame")}</option>
                  {options.data?.data.data.levels
                    .filter((level) => level.game === game)
                    .map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.name} · {t(`qualifications:${level.code}`)}
                      </option>
                    ))}
                </select>
              </div>
            ))}
            {!restore.assignments.length && (
              <p className="muted">{t("membersUi.restoreNeedsGame")}</p>
            )}
          </fieldset>
          <div className="admin-actions">
            <Confirmation
              label={t("membersUi.restore")}
              title={t("membersUi.restoreDialog", { nickname })}
              description={t("membersUi.restoreDescription")}
              busy={busy}
              variant="default"
              disabled={command.held || stale || !restore.assignments.length || !labelsAvailable}
              confirmDisabled={!reasons.restore.trim() || command.held}
              restoreFocus={restoreFocus}
              confirm={async () =>
                labelsAvailable && submit(`/admin/members/${id}/reinstatement`, restore)
              }
            >
              <div className="members-dialog">
                <p>
                  {t("membersUi.restoreRoles", {
                    roles: restore.roles.map((role) => t(role)).join(", "),
                  })}
                </p>
                {restore.assignments.map((input) => (
                  <p key={input.game}>
                    {t(input.game)}:{" "}
                    <LevelLabel game={input.game} levelId={input.levelId} options={options} />
                  </p>
                ))}
                <Points items={[t("membersUi.auditPoint")]} />
                <ReasonField id="members-restore-reason" {...reason("restore")} />
              </div>
            </Confirmation>
          </div>
        </section>
      </>
    );
  return (
    <>
      <section
        className="stack members-section members-roles"
        aria-labelledby="members-roles-title"
      >
        <h3 id="members-roles-title">{t("membersUi.rolesTitle")}</h3>
        {staleAlert}
        <fieldset disabled={blocked} className="members-group">
          <legend>{t("membersUi.membership")}</legend>
          <MembershipRadios
            name="members-membership"
            value={membership}
            onChange={setMembership}
            describedBy="members-membership-help"
            radios={radios}
          />
          <p id="members-membership-help" className="muted">
            {current === "none"
              ? `${t("membersUi.membershipNone")} `
              : current === "both"
                ? `${t("membersUi.membershipBoth")} `
                : ""}
            {t("membersUi.membershipHelp")}
          </p>
        </fieldset>
        {change && (
          <div className="members-unsaved">
            <p>
              <span aria-hidden="true">● </span>
              {t("membersUi.unsaved")}
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setMembership(current === "trainee" || current === "driver" ? current : null);
                // This button leaves with the change; continue at the membership choice.
                (
                  radios.current?.querySelector<HTMLInputElement>(`input[value="${current}"]`) ??
                  radios.current?.querySelector<HTMLInputElement>("input")
                )?.focus();
              }}
            >
              {t("membersUi.reset")}
            </Button>
          </div>
        )}
        {rolesChanged && <p className="muted">{t("membersUi.pendingRoles")}</p>}
        <div className="admin-actions">
          <Confirmation
            label={t("membersUi.changeMembership")}
            title={t("membersUi.membershipDialog", { nickname })}
            description={t("membersUi.membershipDescription")}
            busy={busy}
            disabled={command.held || stale || !change || rolesChanged}
            confirmDisabled={!reasons.membership.trim() || command.held}
            restoreFocus={restoreFocus}
            confirm={async () =>
              !!change &&
              submit(
                `/admin/members/${id}/membership`,
                { membership: change.to, reason: reasons.membership },
                "PUT",
              )
            }
          >
            <div className="members-dialog">
              <Points
                items={[
                  t("membersUi.membershipPoint", {
                    from: membershipLabel(change?.from ?? current),
                    to: membershipLabel(change?.to ?? current),
                  }),
                  t("membersUi.membershipKeeps"),
                  t("membersUi.membershipSession"),
                  t("membersUi.auditPoint"),
                ]}
              />
              <ReasonField id="members-membership-reason" {...reason("membership")} />
            </div>
          </Confirmation>
        </div>
        <fieldset disabled={blocked} className="members-group">
          <legend>{t("membersUi.additional")}</legend>
          <AdditionalChecks
            idPrefix="members-role"
            value={additional}
            onChange={setAdditional}
            checks={checks}
          />
          <p className="muted">{t("membersUi.directorNever")}</p>
        </fieldset>
        {rolesChanged && (
          <div className="members-unsaved">
            <p>
              <span aria-hidden="true">● </span>
              {t("membersUi.unsaved")}
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setAdditional(additionalOf(roles));
                // This button leaves with the change; continue at the first role checkbox.
                checks.current?.querySelector<HTMLInputElement>("input")?.focus();
              }}
            >
              {t("membersUi.reset")}
            </Button>
          </div>
        )}
        {change && <p className="muted">{t("membersUi.pendingMembership")}</p>}
        <div className="admin-actions">
          <Confirmation
            label={t("membersUi.saveRoles")}
            title={t("membersUi.rolesDialog", { nickname })}
            description={t("membersUi.rolesDescription")}
            busy={busy}
            disabled={command.held || stale || !rolesChanged || !!change}
            confirmDisabled={!reasons.roles.trim() || command.held}
            restoreFocus={restoreFocus}
            confirm={() =>
              submit(
                `/admin/members/${id}/roles`,
                { roles: rolesBody(roles, additional), reason: reasons.roles },
                "PUT",
              )
            }
          >
            <div className="members-dialog">
              <Points
                items={[
                  ...diff.added.map((role) => t("membersUi.roleAdded", { role: t(role) })),
                  ...diff.removed.map((role) => t("membersUi.roleRemoved", { role: t(role) })),
                  t("membersUi.rolesKeep"),
                  t("membersUi.rolesSignOut"),
                  t("membersUi.auditPoint"),
                ]}
              />
              <ReasonField id="members-roles-reason" {...reason("roles")} />
            </div>
          </Confirmation>
        </div>
      </section>
      {steam}
      <section
        className="stack members-section members-leave"
        aria-labelledby="members-leave-title"
      >
        <h3 id="members-leave-title">{t("membersUi.leaveTitle")}</h3>
        <p className="muted">{t("membersUi.leaveHelp")}</p>
        <div className="admin-actions">
          <Confirmation
            label={t("membersUi.deactivate")}
            title={t("membersUi.deactivateDialog", { nickname })}
            description={t("membersUi.deactivateDescription")}
            busy={busy}
            disabled={command.held || stale}
            confirmDisabled={!reasons.deactivate.trim() || command.held}
            triggerClassName="members-danger"
            restoreFocus={restoreFocus}
            confirm={() =>
              submit(`/admin/members/${id}/deactivation`, { reason: reasons.deactivate })
            }
          >
            <div className="members-dialog">
              <Points
                items={[
                  t("membersUi.deactivatePoint1"),
                  t("membersUi.deactivatePoint2"),
                  t("membersUi.deactivatePoint3"),
                  t("membersUi.deactivatePoint4"),
                ]}
              />
              <ReasonField id="members-deactivate-reason" {...reason("deactivate")} />
            </div>
          </Confirmation>
        </div>
      </section>
    </>
  );
}
function MemberDetail({
  id,
  back,
  focusOnLoad,
  options,
}: {
  id: string;
  back: () => void;
  focusOnLoad: boolean;
  options: OptionsQuery;
}) {
  const { t } = useTranslation("administration"),
    dates = useDates(),
    command = useWorkspaceCommand(),
    query = useWorkspaceQuery(`/admin/members/${id}`, "EnvelopeMemberAdmin"),
    data = query.data?.data.data,
    root = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    retry = useRef<HTMLButtonElement>(null),
    [focus, setFocus] = useState<FocusRequest | null>(focusOnLoad ? { at: 0, force: true } : null);
  const busy = command.pending || command.seconds > 0;
  const requestFocus = (at: number, force: boolean) => setFocus({ at, force });
  // After a selection on a phone, a committed command or a failure that re-read the member, the
  // panel content was replaced. Once the detail has been read again, move focus to the heading
  // (a forced request) or only when focus was lost with the replaced content.
  const { dataUpdatedAt, isFetching, isError } = query;
  useEffect(() => {
    if (!focus || isFetching) return;
    if (!(data && dataUpdatedAt >= focus.at) && !isError) return;
    setFocus(null);
    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      !active.isConnected ||
      active.getClientRects().length === 0;
    if (!focus.force && !lost) return;
    if (data) heading.current?.focus();
    else root.current?.querySelector<HTMLElement>("[role=alert] button")?.focus();
  }, [focus, data, dataUpdatedAt, isFetching, isError]);
  const panel = data && memberPanel({ roles: data.profile.member.roles, status: data.status });
  const trip = data && lastTrip(data.lastAcceptedTripAt);
  const steam = data && (
    <SteamReplacement
      key={`identity-${data.identityEpoch}`}
      id={id}
      version={query.data?.etag ?? null}
      nickname={data.profile.member.nickname}
      heading={heading}
      committed={(at) => requestFocus(at, true)}
    />
  );
  return (
    <Card ref={root} className="admin-detail members-detail stack">
      <Button className="admin-mobile-back" variant="ghost" onClick={back}>
        {t("back")}
      </Button>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {data && panel && trip && (
        <>
          <div className="members-head">
            <div className="members-title">
              <h2 ref={heading} tabIndex={-1}>
                {data.profile.member.nickname}
              </h2>
              <StatusBadge status={data.status} />
            </div>
            <p>
              {orderedRoles(data.profile.member.roles)
                .map((role) => t(role))
                .join(" · ") || t("membersUi.noRoles")}
            </p>
            <p className="muted">
              {trip.kind === "none"
                ? t("membersUi.noTripsLong")
                : t("membersUi.lastAccepted", {
                    date: dates.day(trip.iso) ?? t("membersUi.levelUnavailable"),
                  })}
            </p>
            <p className="muted">{t("membersUi.detailTimes", { timezone: dates.timezone })}</p>
            <p className="members-break">{data.email}</p>
            <p className="admin-id members-break">{id}</p>
          </div>
          {(command.pending ||
            command.failure ||
            command.seconds > 0 ||
            command.held ||
            command.committed) && (
            <div className="members-feedback stack">
              <CommandFeedback command={command} />
              {command.held && (
                <HeldRetry
                  retry={retry}
                  busy={busy}
                  onRetry={() => {
                    const at = Date.now();
                    void command
                      .run(
                        `/admin/members/${id}/roles`,
                        "EnvelopeCommandResult",
                        undefined,
                        query.data?.etag ?? null,
                      )
                      .then((result) => requestFocus(at, !!result));
                  }}
                />
              )}
            </div>
          )}
          <section className="stack members-section" aria-label={t("qualifications")}>
            <h3>{t("qualifications")}</h3>
            <QueryState
              pending={options.isPending}
              error={options.isError}
              retry={options.refetch}
            />
            {data.profile.qualifications.length ? (
              <dl className="members-facts">
                {data.profile.qualifications.map((assignment) => (
                  <div key={assignment.id}>
                    <dt>{t(`membersUi.gameShort.${assignment.game}`)}</dt>
                    <dd>
                      <LevelLabel
                        game={assignment.game}
                        levelId={assignment.levelId}
                        options={options}
                      />{" "}
                      <span className="muted">
                        {t("membersUi.assignedOn", {
                          date: dates.day(assignment.assignedAt) ?? t("membersUi.levelUnavailable"),
                        })}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>{t("notSet")}</p>
            )}
            <p className="muted">{t("membersUi.qualificationsNote")}</p>
            <Link to={`/account/qualifications?member=${id}`}>{t("qualificationWorkspace")}</Link>
          </section>
          {panel.protected ? (
            <ProtectedPanel roles={data.profile.member.roles} steam={steam} />
          ) : (
            <MemberPanel
              data={data}
              etag={query.data?.etag ?? null}
              command={command}
              options={options}
              steam={steam}
              heading={heading}
              retry={retry}
              requestFocus={requestFocus}
            />
          )}
        </>
      )}
    </Card>
  );
}
const columns = ["colMember", "colRoles", "colEts2", "colAts", "colLast", "colStatus"] as const;
function Members() {
  const { t } = useTranslation("administration"),
    dates = useDates(),
    [params, setParams] = useSearchParams(),
    filters = parseFilters(params),
    path = listPath(filters),
    [selected, setSelected] = useState<string | null>(null),
    [focusOnLoad, setFocusOnLoad] = useState(false),
    [term, setTerm] = useState(filters.search ?? ""),
    [backTo, setBackTo] = useState<string | null | undefined>(undefined),
    [pageFocus, setPageFocus] = useState<string | null>(null),
    master = useRef<HTMLElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    // The search this field last wrote to the URL. Navigation commits in a transition, so the field
    // must not be reset from the URL while its own write is still on the way.
    pushed = useRef(filters.search);
  const query = useWorkspaceQuery(path, "EnvelopeListMemberAdmin"),
    options = useWorkspaceQuery("/admin/reinstatement-options", "EnvelopeReinstatementOptions");
  const items = query.data?.data.data.items,
    levelOptions = options.data?.data.data.levels,
    filtered = !!(filters.role || filters.search);
  function apply(next: Partial<Filters>, replace = false) {
    setSelected(null);
    setParams(filterParams({ ...filters, cursor: null, ...next }), { replace });
  }
  // A search changed outside the field (Reset filters, history navigation) replaces the typed term.
  useEffect(() => {
    if (filters.search === pushed.current) return;
    pushed.current = filters.search;
    setTerm(filters.search ?? "");
  }, [filters.search]);
  useEffect(() => {
    const value = normalizeSearch(term);
    if (value === filters.search) return;
    const timer = setTimeout(() => {
      pushed.current = value;
      setSelected(null);
      setParams(
        (previous) => filterParams({ ...parseFilters(previous), search: value, cursor: null }),
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [term, filters.search, setParams]);
  // Back on a phone returns to the row that was open, or the first row.
  useEffect(() => {
    if (backTo === undefined) return;
    setBackTo(undefined);
    const buttons = [...(master.current?.querySelectorAll<HTMLElement>("tbody th button") ?? [])];
    (
      buttons.find((button) => button.dataset.memberId === backTo) ??
      buttons[0] ??
      master.current
    )?.focus();
  }, [backTo]);
  // The pager buttons can leave with the old page; continue at the new page's first row.
  const { isFetching, isPending } = query;
  useEffect(() => {
    if (pageFocus === null || pageFocus !== path || isFetching || isPending) return;
    setPageFocus(null);
    (master.current?.querySelector<HTMLElement>("tbody th button") ?? master.current)?.focus();
  }, [pageFocus, path, isFetching, isPending]);
  return (
    <div className="administration-page members-page stack">
      <div className="members-heading">
        <WorkspaceHeading title={t("members")} />
        <p className="muted">{t("membersUi.subtitle")}</p>
      </div>
      <nav className="admin-tabs" aria-label={t("status")}>
        {(["active", "inactive"] as const).map((value) => (
          <a
            key={value}
            href={`?${new URLSearchParams(filterParams({ ...filters, status: value, cursor: null }))}`}
            aria-current={value === filters.status ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              apply({ status: value });
            }}
          >
            {t(`membersUi.tabs.${value}`)}
          </a>
        ))}
      </nav>
      <fieldset className="members-toolbar" aria-label={t("membersUi.filters")}>
        <div className="members-search">
          <Label htmlFor="members-search" className="visually-hidden">
            {t("membersUi.search")}
          </Label>
          <Input
            ref={searchInput}
            id="members-search"
            type="search"
            autoComplete="off"
            maxLength={searchMaxLength}
            placeholder={t("membersUi.searchPlaceholder")}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <SegmentedControl<RoleFilter | "all">
          aria-label={t("membersUi.roleFilter")}
          className="members-role-filter"
          value={filters.role ?? "all"}
          options={[
            { value: "all", label: t("membersUi.filterAll") },
            ...roleFilters.map((role) => ({ value: role, label: t(`membersUi.filter.${role}`) })),
          ]}
          onValueChange={(value) => apply({ role: value === "all" ? null : value })}
        />
      </fieldset>
      <div className={`admin-workbench ${selected ? "has-selection" : ""}`}>
        <Card ref={master} className="admin-master members-master stack" tabIndex={-1}>
          <QueryState
            pending={query.isPending}
            error={query.isError}
            retry={query.refetch}
            empty={items?.length === 0 && !filtered}
          />
          {items?.length === 0 && filtered && (
            <div className="members-empty">
              <p>{t("membersUi.noMatches")}</p>
              <Button
                variant="outline"
                onClick={() => {
                  apply({ role: null, search: null });
                  // The button leaves with the empty state; continue at the search field.
                  searchInput.current?.focus();
                }}
              >
                {t("membersUi.resetFilters")}
              </Button>
            </div>
          )}
          {options.isError && (
            <QueryState pending={false} error={options.isError} retry={options.refetch} />
          )}
          {items && items.length > 0 && (
            <Table size="xs" className="members-table" role="table">
              <caption className="visually-hidden">{t("membersUi.listCaption")}</caption>
              {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
              <thead role="rowgroup">
                {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                <tr role="row">
                  {columns.map((column) => (
                    // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                    <th key={column} scope="col" role="columnheader">
                      {t(`membersUi.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
              <tbody role="rowgroup">
                {items.map((row) => {
                  const member = row.profile.member,
                    on = selected === member.id,
                    trip = lastTrip(row.lastAcceptedTripAt);
                  return (
                    // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                    <tr key={member.id} role="row" data-selected={on ? "" : undefined}>
                      {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                      <th scope="row" role="rowheader">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="members-row-button"
                          aria-pressed={on}
                          data-member-id={member.id}
                          onClick={() => {
                            setSelected(member.id);
                            setFocusOnLoad(matchMedia("(max-width: 700px)").matches);
                          }}
                        >
                          {member.nickname}
                        </Button>
                      </th>
                      {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                      <td role="cell">
                        <RoleBadges roles={member.roles} />
                      </td>
                      {games.map((game) => (
                        // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                        <td key={game} role="cell">
                          <span className="members-cell-label" aria-hidden="true">
                            {t(`membersUi.gameShort.${game}`)}
                          </span>
                          <LevelText
                            cell={levelCell(
                              row.profile.qualifications,
                              game,
                              levelOptions,
                              options.isPending,
                              options.isError,
                            )}
                          />
                        </td>
                      ))}
                      {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                      <td role="cell">
                        <span className="members-cell-label" aria-hidden="true">
                          {t("membersUi.colLast")}
                        </span>
                        {trip.kind === "none" ? (
                          t("membersUi.noTrips")
                        ) : (
                          <time dateTime={trip.iso}>
                            {dates.day(trip.iso) ?? t("membersUi.levelUnavailable")}
                          </time>
                        )}
                      </td>
                      {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                      <td role="cell">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <p className="muted">{t("membersUi.footnote", { timezone: dates.timezone })}</p>
          <Pager
            cursor={filters.cursor}
            next={query.data?.data.data.nextCursor}
            setCursor={(next) => {
              const target = { ...filters, cursor: next };
              setSelected(null);
              setPageFocus(listPath(target));
              setParams(filterParams(target));
            }}
          />
        </Card>
        {selected ? (
          <MemberDetail
            key={selected}
            id={selected}
            focusOnLoad={focusOnLoad}
            options={options}
            back={() => {
              setBackTo(selected);
              setSelected(null);
            }}
          />
        ) : (
          <Card className="admin-detail members-detail">
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
