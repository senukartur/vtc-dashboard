// Drivers directory access panel (VTC-160): a drawer on desktop and a bottom sheet on phones over
// the list. It reads the member through the Members page query and sends the Members page
// commands unchanged (membership, roles, deactivation, reinstatement), with their ETag, CSRF,
// idempotency, conflict and permission handling; server rules stay authoritative.
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import type { Locale } from "../../shared/formatting.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog.js";
import { Button, Label, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { CommandFeedback, Confirmation } from "../admin/components.js";
import {
  type Additional,
  additionalOf,
  additionalRoles,
  formatDay,
  type Game,
  games,
  type Membership,
  memberPanel,
  membershipChange,
  membershipOf,
  type Role,
  reinstatementBody,
  roleDiff,
} from "../admin/members-model.js";
import { type DTO, useWorkspaceQuery } from "../admin/transport.js";
import { accessSave } from "./access-model.js";
import { accessHref } from "./directory-model.js";
import { initial } from "./model.js";
import { useAccessCommand, useMemberProfile } from "./queries.js";
import "./drivers-access.css";

type Command = ReturnType<typeof useAccessCommand>;
type OptionsQuery = ReturnType<typeof useWorkspaceQuery<"EnvelopeReinstatementOptions">>;
type RequestFocus = (at: number, force: boolean) => void;

/**
 * `allowed` is the viewer's current members.manage: without it the panel reads nothing and only
 * explains that access was lost (a 403 that refreshed the session). `returnFocus` runs after the
 * panel closes.
 */
export function AccessPanel({
  memberId,
  nickname,
  allowed,
  locale,
  timezone,
  onClose,
  returnFocus,
}: {
  memberId: string;
  /** The row's nickname while the member is read; absent after a deep link. */
  nickname: string | undefined;
  allowed: boolean;
  locale: Locale;
  timezone: string;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { t } = useTranslation("drivers");
  const command = useAccessCommand(memberId);
  const query = useWorkspaceQuery(`/admin/members/${memberId}`, "EnvelopeMemberAdmin", allowed);
  const data = query.data?.data.data;
  const profile = useMemberProfile(memberId).data;
  const options = useWorkspaceQuery(
    "/admin/reinstatement-options",
    "EnvelopeReinstatementOptions",
    allowed && data?.status === "inactive",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const [focus, setFocus] = useState<{ at: number; force: boolean } | null>(null);
  const requestFocus: RequestFocus = (at, force) => setFocus({ at, force });
  const busy = command.pending || command.seconds > 0;

  // After a committed command or a failure that re-read the member, the editor was replaced. Once
  // the member has been read again, move focus to the heading (a forced request) or only when
  // focus was lost with the replaced content, as on the Members page.
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
    if (focus.force || lost) heading.current?.focus();
  }, [focus, data, dataUpdatedAt, isFetching, isError]);

  const member = data?.profile.member ?? profile?.member;
  const name = member?.nickname ?? nickname ?? t("access.title");
  const sinceDay = profile?.memberSince ? formatDay(profile.memberSince, locale, timezone) : null;
  const subtitle = member?.formerMember
    ? t("access.former")
    : sinceDay
      ? t("access.since", { date: sinceDay })
      : null;
  const panel = data && memberPanel({ roles: data.profile.member.roles, status: data.status });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // A command in flight keeps the panel: its result and focus belong here.
        if (!open && !command.pending) onClose();
      }}
    >
      <DialogContent
        className="drivers-access"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        onEscapeKeyDown={(event) => {
          // Escape in a confirmation opened from the panel closes only that confirmation, even
          // when Radix's layer order is stale after another panel closed.
          const dialog = event.target instanceof Element && event.target.closest('[role="dialog"]');
          if (dialog && !dialog.classList.contains("drivers-access")) event.preventDefault();
        }}
      >
        <div className="drivers-access-head">
          <span className="drivers-access-avatar" aria-hidden="true">
            {initial(name)}
          </span>
          <div className="drivers-access-name">
            <DialogTitle asChild>
              <h2 ref={heading} tabIndex={-1}>
                {name}
              </h2>
            </DialogTitle>
            <DialogDescription className="drivers-access-sub">
              <span className="visually-hidden">{t("access.title")}</span>
              {subtitle && (
                <>
                  <span className="visually-hidden"> · </span>
                  {subtitle}
                </>
              )}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="drivers-access-close"
              aria-label={t("access.close")}
              disabled={command.pending}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </DialogClose>
        </div>
        {!allowed ? (
          <p className="drivers-access-notice" role="alert">
            {t("access.permission")}
          </p>
        ) : (
          <>
            {(command.pending ||
              command.failure ||
              command.seconds > 0 ||
              command.held ||
              command.committed) && (
              <div className="drivers-access-feedback">
                <CommandFeedback command={command} />
                {command.held && (
                  <HeldRetry
                    retry={retry}
                    busy={busy}
                    onRetry={() => {
                      const at = Date.now();
                      // The held attempt keeps its own target, body, key and version.
                      void command
                        .run(
                          `/admin/members/${memberId}/roles`,
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
            {query.isPending ? (
              <p className="drivers-access-muted" role="status" aria-busy="true">
                {t("access.loading")}
              </p>
            ) : !data || !panel ? (
              <div className="drivers-access-notice" role="alert">
                <p>{t("access.readError")}</p>
                <Button type="button" variant="outline" size="xs" onClick={() => query.refetch()}>
                  {t("access.retry")}
                </Button>
              </div>
            ) : panel.protected ? (
              <ProtectedAccess roles={data.profile.member.roles} />
            ) : (
              <AccessEditor
                data={data}
                etag={query.data?.etag ?? null}
                command={command}
                options={options}
                heading={heading}
                retry={retry}
                requestFocus={requestFocus}
              />
            )}
            {member && (
              <Link className="drivers-access-settings" to={accessHref(member)}>
                {t("access.allSettings")}
              </Link>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation("drivers");
  return (
    <Button
      ref={retry}
      type="button"
      size="xs"
      className="drivers-access-retry"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onRetry();
      }}
    >
      {t("access.retrySame")}
    </Button>
  );
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
  const { t } = useTranslation("drivers");
  return (
    <div className="drivers-access-field">
      <Label htmlFor={id}>{t("access.reason")}</Label>
      <textarea
        id={id}
        className="input"
        rows={3}
        maxLength={2048}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-help`} className="drivers-access-muted">
        {t("access.reasonHelp")}
      </p>
    </div>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="drivers-access-points">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Trainee or Driver as one pressed option; none pressed when the member holds neither or both. */
function MembershipChoice({
  value,
  onChange,
  describedBy,
  group,
}: {
  value: Membership | null;
  onChange: (value: Membership) => void;
  describedBy?: string;
  group?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation("drivers");
  const labelId = useId();
  return (
    <div ref={group} className="drivers-access-choice" aria-describedby={describedBy}>
      <span id={labelId} className="drivers-access-label">
        {t("access.membership")}
      </span>
      <SegmentedControl<Membership | "none">
        aria-labelledby={labelId}
        value={value ?? "none"}
        onValueChange={(next) => {
          if (next !== "none") onChange(next);
        }}
        options={[
          { value: "trainee", label: t("access.trainee") },
          { value: "driver", label: t("access.driver") },
        ]}
      />
    </div>
  );
}

function AdditionalChoice({
  value,
  onChange,
  describedBy,
  group,
}: {
  value: Additional[];
  onChange: (value: Additional[]) => void;
  describedBy?: string;
  group?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation("drivers");
  const ids = useId();
  const help = {
    dispatcher: "access.dispatcherHelp",
    deputy_director: "access.deputyHelp",
  } as const;
  return (
    <div ref={group} className="drivers-access-checks">
      {additionalRoles.map((role) => (
        <label key={role} className="drivers-access-check" htmlFor={`${ids}-${role}`}>
          <input
            id={`${ids}-${role}`}
            type="checkbox"
            checked={value.includes(role)}
            aria-describedby={[`${ids}-${role}-help`, describedBy].filter(Boolean).join(" ")}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? additionalRoles.filter((item) => item === role || value.includes(item))
                  : value.filter((item) => item !== role),
              )
            }
          />
          <span>
            <span>{t(`access.${role}`)}</span>
            <span id={`${ids}-${role}-help`} className="drivers-access-muted">
              {t(help[role])}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Unsaved({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation("drivers");
  return (
    <div className="drivers-access-unsaved">
      <span>
        <span aria-hidden="true">● </span>
        {t("access.unsaved")}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={onReset}>
        {t("access.reset")}
      </Button>
    </div>
  );
}

/** The serving Director: membership and roles read-only, removal unavailable. */
function ProtectedAccess({ roles }: { roles: Role[] }) {
  const { t } = useTranslation("drivers");
  const session = useSession();
  const noteId = useId();
  const current = membershipOf(roles);
  return (
    <>
      <div className="drivers-access-protected">
        <p className="drivers-access-protected-title">{t("access.protectedTitle")}</p>
        <p id={noteId}>{t("access.protectedNote")}</p>
        {session.self?.capabilities.includes("leadership.transfer") && (
          <Link to="/account/admin/settings">{t("access.transferLink")}</Link>
        )}
      </div>
      <fieldset disabled className="drivers-access-group">
        <MembershipChoice
          value={current === "trainee" || current === "driver" ? current : null}
          onChange={() => undefined}
          describedBy={noteId}
        />
      </fieldset>
      <fieldset disabled className="drivers-access-group">
        <legend className="drivers-access-label">{t("access.additional")}</legend>
        <AdditionalChoice
          value={additionalOf(roles)}
          onChange={() => undefined}
          describedBy={noteId}
        />
      </fieldset>
      <div className="drivers-access-leave">
        <Button
          type="button"
          variant="outline"
          className="drivers-access-danger"
          disabled
          aria-describedby={noteId}
        >
          {t("access.deactivate")}
        </Button>
      </div>
    </>
  );
}

type Reasons = Record<"save" | "deactivate" | "restore", string>;

/**
 * Membership, additional roles, removal and return of a non-protected member. The version read
 * when this editor mounted is sent as If-Match; a newer read marks it stale until refreshed.
 */
function AccessEditor({
  data,
  etag,
  command,
  options,
  heading,
  retry,
  requestFocus,
}: {
  data: DTO["MemberAdmin"];
  etag: string | null;
  command: Command;
  options: OptionsQuery;
  heading: RefObject<HTMLHeadingElement | null>;
  retry: RefObject<HTMLButtonElement | null>;
  requestFocus: RequestFocus;
}) {
  const { t } = useTranslation("drivers");
  const id = data.profile.member.id;
  const nickname = data.profile.member.nickname;
  const roles = data.profile.member.roles;
  const current = membershipOf(roles);
  const initialMembership = current === "trainee" || current === "driver" ? current : null;
  const ids = useId();
  const [reviewedEtag] = useState(etag);
  const stale = reviewedEtag !== etag;
  const [membership, setMembership] = useState<Membership | null>(initialMembership);
  const [additional, setAdditional] = useState<Additional[]>(additionalOf(roles));
  const [reasons, setReasons] = useState<Reasons>({ save: "", deactivate: "", restore: "" });
  const [restoreMembership, setRestoreMembership] = useState<Membership>("trainee");
  const [restoreAdditional, setRestoreAdditional] = useState<Additional[]>([]);
  const [levels, setLevels] = useState<Record<Game, string>>({ ets2: "", ats: "" });
  const membershipGroup = useRef<HTMLDivElement>(null);
  const rolesGroup = useRef<HTMLDivElement>(null);
  const busy = command.pending || command.seconds > 0;
  const blocked = command.held || busy || stale;
  const restoreFocus = () => retry.current ?? heading.current;
  const reason = (key: keyof Reasons) => ({
    value: reasons[key],
    // A held attempt resends its frozen body, so the sent reason stays visible and fixed.
    disabled: busy || command.held,
    onChange: (value: string) => setReasons((previous) => ({ ...previous, [key]: value })),
  });
  /** Runs one member command and asks for the heading once the member was read again. */
  async function submit(path: string, body: unknown, method = "POST") {
    const at = Date.now();
    const done = !!(await command.run(path, "EnvelopeCommandResult", body, reviewedEtag, method));
    requestFocus(at, done);
    return done;
  }
  const membershipLabel = (value: string) =>
    value === "none" || value === "both"
      ? t(`access.membershipFrom.${value}`)
      : t(`access.${value as Membership}`);
  const staleAlert = stale && (
    <div className="drivers-access-notice">
      <p role="alert">{t("access.stale")}</p>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={command.held || busy}
        onClick={() => {
          const at = Date.now();
          void command.refresh(`/admin/members/${id}`).then(() => requestFocus(at, false));
        }}
      >
        {t("access.refresh")}
      </Button>
    </div>
  );
  const leave = (
    <div className="drivers-access-leave">
      <Confirmation
        label={t("access.deactivate")}
        title={t("access.deactivateDialog", { nickname })}
        description={t("access.deactivateDescription")}
        busy={busy}
        disabled={command.held || stale}
        confirmDisabled={!reasons.deactivate.trim() || command.held}
        triggerClassName="drivers-access-danger"
        restoreFocus={restoreFocus}
        confirm={() => submit(`/admin/members/${id}/deactivation`, { reason: reasons.deactivate })}
      >
        <div className="drivers-access-dialog">
          <Points
            items={[
              t("access.deactivatePoint1"),
              t("access.deactivatePoint2"),
              t("access.deactivatePoint3"),
              t("access.deactivatePoint4"),
            ]}
          />
          <ReasonField id={`${ids}-deactivate`} {...reason("deactivate")} />
        </div>
      </Confirmation>
      <p className="drivers-access-muted">{t("access.deactivateNote")}</p>
    </div>
  );

  if (data.status === "inactive") {
    const restore = reinstatementBody(
      restoreMembership,
      restoreAdditional,
      levels,
      reasons.restore,
    );
    const known = options.data?.data.data.levels;
    const labelsAvailable = restore.assignments.every((input) =>
      known?.some((level) => level.id === input.levelId && level.game === input.game),
    );
    return (
      <section className="drivers-access-section" aria-labelledby={`${ids}-restore`}>
        <h3 id={`${ids}-restore`}>{t("access.restoreTitle")}</h3>
        <p className="drivers-access-muted">{t("access.restoreHelp")}</p>
        {staleAlert}
        <fieldset disabled={blocked} className="drivers-access-group">
          <MembershipChoice value={restoreMembership} onChange={setRestoreMembership} />
        </fieldset>
        <fieldset disabled={blocked} className="drivers-access-group">
          <legend className="drivers-access-label">{t("access.additional")}</legend>
          <AdditionalChoice value={restoreAdditional} onChange={setRestoreAdditional} />
        </fieldset>
        <fieldset disabled={blocked} className="drivers-access-group">
          <legend className="drivers-access-label">{t("access.qualifications")}</legend>
          {options.isPending && (
            <p className="drivers-access-muted" role="status">
              {t("access.levelsLoading")}
            </p>
          )}
          {options.isError && (
            <div className="drivers-access-notice" role="alert">
              <p>{t("access.levelsError")}</p>
              <Button type="button" variant="outline" size="xs" onClick={() => options.refetch()}>
                {t("access.retry")}
              </Button>
            </div>
          )}
          {games.map((game) => (
            <div className="drivers-access-field" key={game}>
              <Label htmlFor={`${ids}-${game}`}>{t(`access.${game}`)}</Label>
              <Select
                id={`${ids}-${game}`}
                value={levels[game]}
                onChange={(event) =>
                  setLevels((previous) => ({ ...previous, [game]: event.target.value }))
                }
              >
                <option value="">{t("access.noGame")}</option>
                {known
                  ?.filter((level) => level.game === game)
                  .map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
              </Select>
            </div>
          ))}
          {!restore.assignments.length && (
            <p className="drivers-access-muted">{t("access.restoreNeedsGame")}</p>
          )}
        </fieldset>
        <div className="drivers-access-actions">
          <Confirmation
            label={t("access.restore")}
            title={t("access.restoreDialog", { nickname })}
            description={t("access.restoreDescription")}
            busy={busy}
            variant="default"
            disabled={command.held || stale || !restore.assignments.length || !labelsAvailable}
            confirmDisabled={!reasons.restore.trim() || command.held}
            restoreFocus={restoreFocus}
            confirm={async () =>
              labelsAvailable && submit(`/admin/members/${id}/reinstatement`, restore)
            }
          >
            <div className="drivers-access-dialog">
              <p>
                {t("access.restoreRoles", {
                  roles: restore.roles.map((role) => t(`access.${role}`)).join(", "),
                })}
              </p>
              {restore.assignments.map((input) => (
                <p key={input.game}>
                  {t("access.restoreLevel", {
                    game: t(`access.${input.game}`),
                    level:
                      known?.find(
                        (level) => level.id === input.levelId && level.game === input.game,
                      )?.name ?? t("access.levelUnavailable"),
                  })}
                </p>
              ))}
              <Points items={[t("access.auditPoint")]} />
              <ReasonField id={`${ids}-restore-reason`} {...reason("restore")} />
            </div>
          </Confirmation>
        </div>
      </section>
    );
  }

  const save = accessSave(id, roles, membership, additional, reasons.save);
  const membershipChanged = !!membershipChange(roles, membership);
  const diff = roleDiff(roles, additional);
  const rolesChanged = diff.added.length + diff.removed.length > 0;
  return (
    <>
      <section className="drivers-access-section" aria-labelledby={`${ids}-roles`}>
        <h3 id={`${ids}-roles`} className="visually-hidden">
          {t("access.title")}
        </h3>
        {staleAlert}
        <fieldset disabled={blocked} className="drivers-access-group">
          <MembershipChoice
            value={membership}
            onChange={setMembership}
            describedBy={`${ids}-membership-help`}
            group={membershipGroup}
          />
          <p id={`${ids}-membership-help`} className="drivers-access-muted">
            {current === "none"
              ? `${t("access.membershipNone")} `
              : current === "both"
                ? `${t("access.membershipBoth")} `
                : ""}
            {t("access.membershipHelp")}
          </p>
          {membershipChanged && (
            <Unsaved
              onReset={() => {
                setMembership(initialMembership);
                // The Reset button leaves with the change; continue at the restored option
                // (Trainee, Driver in order), before the re-render moves aria-pressed there.
                const buttons = membershipGroup.current?.querySelectorAll<HTMLElement>("button");
                buttons?.[initialMembership === "driver" ? 1 : 0]?.focus();
              }}
            />
          )}
        </fieldset>
        <fieldset disabled={blocked} className="drivers-access-group">
          <legend className="drivers-access-label">{t("access.additional")}</legend>
          <AdditionalChoice value={additional} onChange={setAdditional} group={rolesGroup} />
          <p className="drivers-access-muted">{t("access.directorNever")}</p>
          {rolesChanged && (
            <Unsaved
              onReset={() => {
                setAdditional(additionalOf(roles));
                rolesGroup.current?.querySelector<HTMLInputElement>("input")?.focus();
              }}
            />
          )}
        </fieldset>
        {save.kind === "both" && (
          <p className="drivers-access-warning" id={`${ids}-both`}>
            {t("access.bothChanged")}
          </p>
        )}
        <div className="drivers-access-actions">
          <Confirmation
            label={t("access.save")}
            title={
              save.kind === "roles"
                ? t("access.rolesDialog", { nickname })
                : t("access.membershipDialog", { nickname })
            }
            description={
              save.kind === "roles"
                ? t("access.rolesDescription")
                : t("access.membershipDescription")
            }
            busy={busy}
            variant="default"
            disabled={command.held || stale || save.kind === "none" || save.kind === "both"}
            confirmDisabled={!reasons.save.trim() || command.held}
            restoreFocus={restoreFocus}
            confirm={async () =>
              (save.kind === "membership" || save.kind === "roles") &&
              submit(save.path, save.body, "PUT")
            }
          >
            <div className="drivers-access-dialog">
              <Points
                items={
                  save.kind === "roles"
                    ? [
                        ...save.diff.added.map((role) =>
                          t("access.roleAdded", { role: t(`access.${role}`) }),
                        ),
                        ...save.diff.removed.map((role) =>
                          t("access.roleRemoved", { role: t(`access.${role}`) }),
                        ),
                        t("access.rolesKeep"),
                        t("access.rolesSignOut"),
                        t("access.auditPoint"),
                      ]
                    : [
                        t("access.membershipPoint", {
                          from: membershipLabel(
                            save.kind === "membership" ? save.change.from : current,
                          ),
                          to: membershipLabel(
                            save.kind === "membership" ? save.change.to : current,
                          ),
                        }),
                        t("access.membershipKeeps"),
                        t("access.membershipSession"),
                        t("access.auditPoint"),
                      ]
                }
              />
              <ReasonField id={`${ids}-save`} {...reason("save")} />
            </div>
          </Confirmation>
          <span className="drivers-access-muted">{t("access.audit")}</span>
        </div>
      </section>
      {leave}
    </>
  );
}
