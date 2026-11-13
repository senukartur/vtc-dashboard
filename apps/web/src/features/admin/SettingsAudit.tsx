import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { QueryState } from "./components.js";
import {
  auditAction,
  auditActions,
  auditPath,
  auditSnapshot,
  shortAuditId,
  validReportingTimezone,
} from "./settings-model.js";
import { type DTO, useWorkspaceQuery } from "./transport.js";

type Row = DTO["AuditStage3Entry"];

function AuditChange({ row }: { row: Row }) {
  const { t } = useTranslation("administration");
  const action = auditAction(row.action);
  return (
    <>
      <strong>{action ? t(`auditActions.${auditActions[action]}`) : t("auditUnknown")}</strong>
      <p>
        {t(`settingsUi.audit.object.${row.objectType}`)}
        {" · "}
        {row.objectName || t("settingsUi.audit.reference", { id: shortAuditId(row.subjectId) })}
      </p>
      {row.details ? (
        <>
          {row.action === "configuration.changed" && <p>{t("reportingTimezone")}</p>}
          <dl className="settings-audit-change">
            <div>
              <dt>{t("settingsUi.audit.before")}</dt>
              <dd>
                {auditSnapshot(row, "before", t)}
                <span aria-hidden="true" className="settings-audit-arrow">
                  →
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("settingsUi.audit.after")}</dt>
              <dd>{auditSnapshot(row, "after", t)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="muted">{t("settingsUi.audit.legacy")}</p>
      )}
    </>
  );
}

export function SettingsAudit({
  reportingTimezone,
  timezonePending,
}: {
  reportingTimezone: string | null;
  timezonePending: boolean;
}) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    location = useLocation(),
    navigate = useNavigate(),
    params = new URLSearchParams(location.search),
    action = auditAction(params.get("action"));
  const authority = [
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
  ].join(":");

  return (
    <Card className="settings-audit">
      <div className="settings-section-head">
        <h2>{t("audit")}</h2>
        <div className="settings-audit-filter">
          <Label htmlFor="settings-audit-action">{t("action")}</Label>
          <Select
            id="settings-audit-action"
            value={action ?? ""}
            onChange={(event) => {
              if (event.target.value) params.set("action", event.target.value);
              else params.delete("action");
              navigate({ search: params.toString(), hash: location.hash });
            }}
          >
            <option value="">{t("settingsUi.audit.allActions")}</option>
            {Object.entries(auditActions).map(([value, label]) => (
              <option key={value} value={value}>
                {t(`auditActions.${label}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <AuditResults
        key={JSON.stringify([authority, action])}
        action={action}
        reportingTimezone={reportingTimezone}
        timezonePending={timezonePending}
      />
    </Card>
  );
}

type AuditPage = { cursor: string; offset: number };

function AuditResults({
  action,
  reportingTimezone,
  timezonePending,
}: {
  action: ReturnType<typeof auditAction>;
  reportingTimezone: string | null;
  timezonePending: boolean;
}) {
  const { t, i18n } = useTranslation("administration"),
    [pages, setPages] = useState<AuditPage[]>([]),
    position = pages.at(-1),
    cursor = position?.cursor,
    results = useRef<HTMLDivElement>(null),
    query = useWorkspaceQuery(auditPath(action, cursor), "AuditStage3ListEnvelope"),
    page = timezonePending ? undefined : query.data?.data.data,
    failure = query.error instanceof AccountFailure ? query.error.kind : null,
    denied = failure === "forbidden" || failure === "unauthorized";
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = validReportingTimezone(reportingTimezone) ? reportingTimezone : null,
    next = page?.nextCursor,
    offset = position?.offset ?? 0,
    end = offset + (page?.items.length ?? 0),
    numbers = new Intl.NumberFormat(locale);

  function goTo(pages: AuditPage[]) {
    setPages(pages);
    results.current?.focus();
  }

  return (
    <div className="settings-audit-results stack" ref={results} tabIndex={-1}>
      {!timezonePending && (
        <p className="muted">
          {timezone ? t("settingsUi.audit.times", { timezone }) : t("settingsUi.audit.utcFallback")}
        </p>
      )}
      {denied ? (
        <p role="alert">{t("settingsUi.sectionRestricted")}</p>
      ) : failure === "conflict" && cursor ? (
        <div role="alert">
          <p>{t("settingsUi.audit.staleCursor")}</p>
          <Button variant="outline" onClick={() => goTo([])}>
            {t("first")}
          </Button>
        </div>
      ) : (
        <QueryState
          pending={query.isPending || (timezonePending && !query.isError)}
          error={query.isError}
          retry={query.refetch}
          empty={page?.items.length === 0}
        />
      )}
      {!!page?.items.length && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling.
        <section className="admin-table-scroll" aria-label={t("audit")} tabIndex={0}>
          <table className="admin-safe-table admin-audit-table settings-audit-table">
            <thead>
              <tr>
                <th scope="col">{t("settingsUi.audit.when")}</th>
                <th scope="col">{t("settingsUi.audit.who")}</th>
                <th scope="col">{t("settingsUi.audit.what")}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <time dateTime={row.occurredAt}>
                      {formatUtc(row.occurredAt, locale, timezone ?? "UTC")}
                    </time>
                  </td>
                  <td>
                    {row.actorNickname ||
                      (row.actorId
                        ? t("settingsUi.audit.reference", { id: shortAuditId(row.actorId) })
                        : t("system"))}
                  </td>
                  <td>
                    <AuditChange row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {page && (
        <div className="settings-audit-foot">
          {page.items.length > 0 ? (
            <p className="muted">
              {t(
                page.total === undefined
                  ? "settingsUi.audit.range"
                  : "settingsUi.audit.rangeAndTotal",
                {
                  first: numbers.format(offset + 1),
                  last: numbers.format(end),
                  total: numbers.format(page.total ?? 0),
                },
              )}
            </p>
          ) : page.total !== undefined ? (
            <p className="muted">
              {t("settingsUi.audit.total", { total: numbers.format(page.total) })}
            </p>
          ) : null}
          <div className="button-row">
            {cursor && (
              <Button variant="outline" onClick={() => goTo(pages.slice(0, -1))}>
                {t("settingsUi.audit.previous")}
              </Button>
            )}
            {next && (
              <Button
                variant="outline"
                onClick={() => goTo([...pages, { cursor: next, offset: end }])}
              >
                {t("next")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
