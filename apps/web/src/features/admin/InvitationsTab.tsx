// Invited tab of the drivers directory (VTC-145): current invitation generations for
// applications.manage. Only applicant nicknames and expiry times are rendered; the server never
// returns links or tokens, and applicant emails stay out of the markup.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { useCursorPages } from "../../shared/paging.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import {
  approvedApplicationsHref,
  INVITATIONS_PAGE_SIZE,
  type InvitationListState,
  invitationCountPath,
  invitationsPath,
} from "./invitations-model.js";
import { type DTO, useWorkspaceQuery } from "./transport.js";

type Item = DTO["InvitationStage4ListItem"];

/** Active invitations total for the tab counter; undefined while unknown or on failure. */
export function useInvitationCount(enabled: boolean): number | undefined {
  const query = useWorkspaceQuery(invitationCountPath, "InvitationStage4ListEnvelope", enabled);
  return enabled ? query.data?.data.data.total : undefined;
}

export function InvitationsList({
  state,
  onStateChange,
  timezone,
}: {
  state: InvitationListState;
  onStateChange: (state: InvitationListState) => void;
  timezone: string;
}) {
  const { t, i18n } = useTranslation("drivers");
  const locale: Locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const pages = useCursorPages(`invitations:${state}`);
  const query = useWorkspaceQuery(
    invitationsPath(state, pages.cursor),
    "InvitationStage4ListEnvelope",
  );
  // A rejected cursor restarts the same state's first page without rendering an error.
  pages.recover(query.error);
  const list = query.data?.data.data;
  const columns: DataTableColumn<Item>[] = [
    {
      id: "applicant",
      header: t("invited.applicant"),
      rowHeader: true,
      className: "drivers-col-applicant",
      cell: (item) => <span className="drivers-applicant">{item.applicant.nickname}</span>,
    },
    {
      id: "expires",
      header: t(state === "active" ? "invited.expires" : "invited.expired"),
      className: "drivers-col-expires",
      cell: (item) => <span>{formatUtc(item.invitation.expiresAt, locale, timezone)}</span>,
    },
  ];
  return (
    <div className="drivers-invited">
      <div className="drivers-invited-bar">
        <SegmentedControl
          aria-label={t("invited.state")}
          size="sm"
          value={state}
          onValueChange={onStateChange}
          options={[
            { value: "active", label: t("invited.active") },
            { value: "expired", label: t("invited.expiredState") },
          ]}
        />
        <Link className="drivers-invited-link" to={approvedApplicationsHref}>
          {t("invited.applications")}
        </Link>
      </div>
      <DataTable
        className="drivers-invited-table"
        caption={t(state === "active" ? "invited.captionActive" : "invited.captionExpired")}
        columns={columns}
        rows={list?.items}
        rowKey={(item) => item.invitation.id}
        status={query.isError ? "error" : list ? "ready" : "loading"}
        error={t("invited.error")}
        onRetry={() => {
          pages.restart();
          if (!pages.cursor) void query.refetch();
        }}
        empty={{ message: t(state === "active" ? "invited.emptyActive" : "invited.emptyExpired") }}
        pagination={{
          pages,
          nextCursor: list?.nextCursor,
          pageSize: INVITATIONS_PAGE_SIZE,
          total: list?.total,
        }}
        footer={<small className="drivers-footnote">{t("invited.times", { timezone })}</small>}
      />
    </div>
  );
}
