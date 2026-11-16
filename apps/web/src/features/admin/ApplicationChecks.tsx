import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import i18n from "../../shared/i18n.js";
import { Button } from "../../shared/ui/primitives.js";
import {
  type CheckPart,
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
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
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
    [step, setStep] = useState(0);
  const shown = newerCheck(check, updatedAt, poll.query.data, poll.query.dataUpdatedAt),
    view = checkView(shown),
    running = shown?.state === "checking",
    { isFetching, isError, refetch } = poll.query;
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
    setStep(0);
    poll.seed(result.data);
  }
  return (
    <div className="applications-wide applications-check">
      <dt>{t("truckersmp")}</dt>
      <dd>
        <p className="applications-check-state" role={view.live ? "status" : undefined}>
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
            <p role="alert">{t("errors.wait", { seconds: command.seconds })}</p>
          ) : (
            <p role="alert">{t(`errors.${failure}`)}</p>
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
