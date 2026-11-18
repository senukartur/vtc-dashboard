import {
  Ban,
  Building2,
  CircleHelp,
  Clock,
  EyeOff,
  ShieldCheck,
  TriangleAlert,
  UserX,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, formatUtc } from "../../shared/formatting.js";
import i18n from "../../shared/i18n.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import {
  type CheckGroup,
  type CheckPart,
  checkBadge,
  checkBadgeLook,
  checkView,
  newerCheck,
  pollDelay,
  recheckFeedback,
  referralView,
  type TruckersmpCheck,
} from "./application-checks-model.js";
import { useCheckPoll } from "./application-checks-query.js";
import { applicationChecksTranslations } from "./application-checks-translations.js";
import type { DTO, useWorkspaceCommand } from "./transport.js";
import "./application-checks.css";
// The shared .popover-content surface lives in this stylesheet, which the applications chunk does
// not load otherwise; without it the legend tip renders without its background.
import "../../shared/ui/date-time-field.css";

// The namespace loads with the applications chunk instead of the shared startup bundle.
for (const language of ["ru", "en"] as const)
  i18n.addResourceBundle(
    language,
    "applicationChecks",
    applicationChecksTranslations[language],
    true,
    true,
  );

function useFormat() {
  const { i18n: current } = useTranslation("applicationChecks"),
    session = useSession();
  const locale = current.resolvedLanguage === "en" ? "en" : "ru",
    timezone = accountTimeZone(session.self?.preferences.displayTimezone);
  return (value: string | null | undefined) => formatUtc(value ?? null, locale, timezone);
}
function Parts({ parts }: { parts: CheckPart[] }) {
  const { t } = useTranslation("applicationChecks"),
    format = useFormat();
  return parts.map((part, index) => (
    // Each phrase key occurs at most once per line.
    <Fragment key={part.key}>
      {index > 0 && " · "}
      {part.key === "player" ? (
        part.href ? (
          <a className="applications-break" href={part.href} target="_blank" rel="noreferrer">
            {part.text}
          </a>
        ) : (
          <span className="applications-break">{part.text}</span>
        )
      ) : part.key === "vtc" ? (
        <span className="applications-break">{t("vtc", { name: part.text })}</span>
      ) : (
        t(part.key, {
          ...(part.count === undefined ? {} : { count: part.count }),
          ...(part.at === undefined ? {} : { date: format(part.at) }),
          ...(part.reason ? { reason: t(`failure.${part.reason}`) } : {}),
        })
      )}
    </Fragment>
  ));
}

/** TruckersMP check row of the application detail; polls only while a check runs. */
export function TruckersmpFact({
  id,
  check,
  updatedAt,
  command,
}: {
  id: string;
  check: TruckersmpCheck | undefined;
  updatedAt: number;
  /** The detail's recheck command, kept across the detail re-read that 403 and 409 trigger. */
  command: ReturnType<typeof useWorkspaceCommand>;
}) {
  const { t } = useTranslation("applicationChecks"),
    session = useSession(),
    poll = useCheckPoll(id),
    [step, setStep] = useState(0),
    stateLine = useRef<HTMLParagraphElement>(null),
    alert = useRef<HTMLParagraphElement>(null),
    focusState = useRef(false);
  const shown = newerCheck(check, updatedAt, poll.query.data, poll.query.dataUpdatedAt),
    view = checkView(shown),
    running = shown?.state === "checking",
    { isFetching, isError, refetch } = poll.query;
  // Every newly running check, from a recheck or a detail re-read, starts the 5-second ramp again.
  const [wasRunning, setWasRunning] = useState(running);
  if (running !== wasRunning) {
    setWasRunning(running);
    if (running) setStep(0);
  }
  useEffect(() => {
    if (!running || isFetching || isError) return;
    const timer = setTimeout(() => {
      setStep((current) => current + 1);
      void refetch();
    }, pollDelay(step));
    return () => clearTimeout(timer);
  }, [running, isFetching, isError, step, refetch]);
  const canRecheck =
    view.recheck !== "hidden" && !!session.self?.capabilities.includes("applications.manage");
  const failure = command.failure && recheckFeedback(command.failure.kind);
  // The accepted recheck hides its focused button: focus the running state, which also has it read.
  useEffect(() => {
    if (!focusState.current || !running) return;
    focusState.current = false;
    stateLine.current?.focus();
  });
  // A 403 or 409 re-reads the detail and remounts this row without its focused button; keep the
  // keyboard position on the explanation instead of the document body.
  useEffect(() => {
    if (!command.failure) return;
    const active = document.activeElement;
    if (!active || active === document.body) alert.current?.focus();
  }, [command.failure]);
  async function recheck() {
    const result = await command.run(
      `/admin/applications/${id}/truckersmp-checks`,
      "ApplicationStage4TruckersmpCheckEnvelope",
      undefined,
      null,
      "POST",
      false,
    );
    if (!result) return;
    focusState.current = result.data.state === "checking";
    poll.seed(result.data);
  }
  return (
    <div className="applications-wide applications-check">
      <dt>{t("truckersmp")}</dt>
      <dd>
        <p
          ref={stateLine}
          className="applications-check-state"
          role={view.live ? "status" : undefined}
          tabIndex={-1}
        >
          <Parts parts={view.parts} />
        </p>
        {view.previous && (
          <p className="muted">
            {t("previous")} <Parts parts={view.previous} />
          </p>
        )}
        {canRecheck && (
          <Button
            className="applications-check-action"
            variant="outline"
            size="xs"
            disabled={command.pending || command.seconds > 0}
            onClick={() => void recheck()}
          >
            {t(command.pending ? "starting" : view.recheck)}
          </Button>
        )}
        {running && isError && !isFetching && (
          <div className="applications-check-line">
            <p className="muted">{t("pollFailed")}</p>
            <Button variant="outline" size="xs" onClick={() => void refetch()}>
              {t("refresh")}
            </Button>
          </div>
        )}
        {failure &&
          (failure === "limited" && command.seconds > 0 ? (
            <p ref={alert} role="alert" tabIndex={-1}>
              {t("errors.wait", { seconds: command.seconds })}
            </p>
          ) : (
            <p ref={alert} role="alert" tabIndex={-1}>
              {t(`errors.${failure}`)}
            </p>
          ))}
      </dd>
    </div>
  );
}

/** Referral answer of the application; earlier applications have none. */
export function ReferralFact({ fields }: { fields: DTO["ApplicationInput"] }) {
  const { t } = useTranslation("applicationChecks"),
    view = referralView(fields);
  return (
    <div className="applications-wide">
      <dt>{t("referral")}</dt>
      <dd
        className={view.kind === "other" ? "applications-referral applications-break" : undefined}
      >
        {view.kind === "none"
          ? t("referralNone")
          : view.kind === "other"
            ? t("referralOther", {
                label: t("admissions:referralOptions.other"),
                text: view.text,
              })
            : t(`admissions:referralOptions.${view.source}`)}
      </dd>
    </div>
  );
}

/** List badge of one application's check; text and symbol, not colour, carry the state. */
export function TruckersmpBadge({ check }: { check: TruckersmpCheck | null | undefined }) {
  const { t } = useTranslation("applicationChecks"),
    { group, label } = checkBadge(check);
  const icons = {
    noBans: ShieldCheck,
    hasBans: Ban,
    bansHidden: EyeOff,
    notFound: UserX,
    inVtc: Building2,
    failed: X,
    checking: Clock,
    notChecked: CircleHelp,
  };
  return (
    <Badge
      size="xs"
      tone={checkBadgeLook[group].tone}
      icon={icons[label]}
      className="applications-check-badge"
    >
      {t(`badge.${label}`)}
    </Badge>
  );
}

const legendGroups: readonly CheckGroup[] = ["passed", "attention", "failed", "pending"];
/** What the list badges mean, behind the shared info tip. */
export function TruckersmpLegend() {
  const { t } = useTranslation("applicationChecks");
  return (
    <div className="applications-check-legend">
      <span>{t("legendLead")}</span>
      <InfoTip label={t("legendLabel")} title={t("legendTitle")}>
        {legendGroups.map((group) => (
          <p key={group}>
            <Badge
              tone={checkBadgeLook[group].tone}
              icon={
                group === "passed"
                  ? ShieldCheck
                  : group === "attention"
                    ? TriangleAlert
                    : group === "failed"
                      ? X
                      : CircleHelp
              }
            >
              {t(
                group === "passed"
                  ? "badge.noBans"
                  : group === "attention"
                    ? "badge.hasBans"
                    : group === "failed"
                      ? "badge.failed"
                      : "badge.notChecked",
              )}
            </Badge>{" "}
            {t(`legend.${group}`)}
          </p>
        ))}
        <p>{t("legend.detail")}</p>
      </InfoTip>
    </div>
  );
}
