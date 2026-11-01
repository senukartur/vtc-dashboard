import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";
import { formatUtc } from "../../shared/formatting.js";
import { Button, Card, Table } from "../../shared/ui/primitives.js";
import { type RevisionStatus, revisionRows } from "./model.js";
import { StateBadge } from "./ReviewTables.js";

const statusLabel: Record<RevisionStatus, string> = {
  current: "statusCurrent",
  replaced: "statusReplaced",
  draft: "statusDraft",
  validated: "statusValidated",
  rejected: "statusRejected",
};

/** Published revisions (current first) plus the open, unpublished candidate as a review row. */
export function CatalogRevisions({
  game,
  published,
  candidate,
  isPending,
  isError,
  isSuccess,
  hasNextPage,
  isFetchingNextPage,
  refetch,
  fetchNextPage,
}: {
  game: Game;
  published: CatalogDTO["CatalogRevision"][];
  candidate: CatalogDTO["CatalogRevision"] | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: () => void;
  fetchNextPage: () => void;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    headingId = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const rows = revisionRows(published, candidate, game);
  return (
    <Card className="catalog-card catalog-revisions" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("revisionsTitle", { game: game.toUpperCase() })}</h2>
      {rows.length > 0 && (
        <Table size="xs" className="catalog-table catalog-revisions-table">
          <thead>
            <tr>
              <th scope="col">{t("revisionColumn")}</th>
              <th scope="col">{t("stateColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ revision, status }) => (
              <tr key={revision.id}>
                <th scope="row">
                  {formatUtc(revision.createdAt, locale, "UTC")}
                  <code className="catalog-id">{revision.id}</code>
                </th>
                <td>
                  <StateBadge state={status} label={t(statusLabel[status])} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {isPending && <p role="status">{t("loading")}</p>}
      {isError && (
        <div role="alert" className="catalog-inline-alert">
          <p>{t("readError")}</p>
          <Button size="xs" variant="outline" onClick={refetch}>
            {t("refresh")}
          </Button>
        </div>
      )}
      {isSuccess && !published.length && <p>{t("noPublication")}</p>}
      {hasNextPage && (
        <Button
          size="xs"
          variant="outline"
          className="catalog-more"
          disabled={isFetchingNextPage}
          onClick={fetchNextPage}
        >
          {t("more")}
        </Button>
      )}
      <p className="catalog-muted">{t("revisionsFoot")}</p>
    </Card>
  );
}
