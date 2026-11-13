import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { Confirm, Failure, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { CatalogName, GameChip } from "../trips/TripTable.js";
import type { DTO } from "../trips/transport.js";
import { displayTimezone } from "./reference-time.js";
import "./manual-reports.css";

export const draftsLocation = "/account/trips?tab=drafts";

/** Draft pages with city and cargo labels in the interface language, not the account one. */
export function useManualDrafts(enabled: boolean, cursor?: string | null, editingOnly = true) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  return useTripQuery(
    `/me/manual-drafts?${queryString({ state: editingOnly ? "editing" : undefined, locale, limit: 25, cursor })}`,
    "EnvelopeListManualDraft",
    enabled,
  );
}

export function DraftFeedback({ kind }: { kind: "draftDeleted" | "draftDeleteConflict" | null }) {
  const { t } = useTranslation("trips");
  if (!kind) return null;
  return kind === "draftDeleted" ? (
    <p role="status">{t(kind)}</p>
  ) : (
    <p role="alert" className="field-error">
      {t(kind)}
    </p>
  );
}

export function DeleteDraft({
  id,
  etag,
  descriptionId,
  disabled,
  onDeleted,
  onConflict,
}: {
  id: string;
  etag: string | null | undefined;
  descriptionId?: string;
  disabled?: boolean;
  onDeleted: () => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation("trips");
  const command = useTripCommand(onConflict);
  const conflict = command.failure?.kind === "conflict";
  return (
    <>
      {!conflict && <Failure error={command.failure} seconds={command.seconds} />}
      <Confirm
        label={t("deleteDraft")}
        title={t("deleteDraftTitle")}
        description={t("deleteDraftHelp")}
        destructiveLabel={t("deleteDraft")}
        describedBy={descriptionId}
        guard={etag ?? ""}
        pending={command.pending}
        failure={command.failure}
        disabled={!etag || disabled || command.seconds > 0}
        onConfirm={async () => {
          if (!etag) return;
          const result = await command.run(
            `/me/manual-drafts/${id}`,
            undefined,
            "EnvelopeCommandResult",
            etag,
            "DELETE",
          );
          if (result) onDeleted();
          return result;
        }}
      >
        {null}
      </Confirm>
    </>
  );
}

export function DraftList({
  first,
  headingLevel = 2,
  headingTitle,
  editingOnly = true,
}: {
  first: ReturnType<typeof useManualDrafts>;
  headingLevel?: 1 | 2;
  headingTitle?: string;
  editingOnly?: boolean;
}) {
  const { t, i18n } = useTranslation("trips");
  const session = useSession();
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const timezone = displayTimezone(session.self?.preferences.displayTimezone);
  const pages = useCursorPages(`${editingOnly ? "editing" : "all"}:${locale}`);
  const [notice, setNotice] = useState<"draftDeleted" | "draftDeleteConflict" | null>(
    location.state?.draftDeleted === true ? "draftDeleted" : null,
  );
  const [focusAfter, setFocusAfter] = useState<{ removed: string; neighbor?: string } | null>(null);
  const next = useManualDrafts(!!pages.cursor, pages.cursor, editingOnly);
  const query = pages.cursor ? next : first;
  const list = query.data?.data.data;
  const items = list?.items;
  // A rejected cursor, or a later page emptied by deletions, restarts at the first page.
  if (!pages.recover(query.error) && pages.cursor && items?.length === 0) pages.restart();

  useLayoutEffect(() => {
    if (!focusAfter || !items || items.some(({ id }) => id === focusAfter.removed)) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        const neighbor =
          focusAfter.neighbor && document.getElementById(`draft-resume-${focusAfter.neighbor}`);
        (neighbor || heading.current)?.focus();
      }
      setFocusAfter(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfter, items]);

  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="manual-drafts stack" aria-labelledby={headingId}>
      <Heading ref={heading} id={headingId} tabIndex={-1}>
        {headingTitle ?? t("drafts")}
      </Heading>
      <DraftFeedback kind={notice} />
      <State query={query} />
      {items?.length === 0 && <p>{t("draftsEmpty")}</p>}
      {!!items?.length && (
        <div className="manual-draft-list">
          {items.map((draft, index) => {
            const rowId = `draft-route-${draft.id}`;
            const neighbor = items[index + 1]?.id ?? items[index - 1]?.id;
            const setFeedback = (kind: "draftDeleted" | "draftDeleteConflict") => {
              setNotice(kind);
              setFocusAfter({ removed: draft.id, ...(neighbor ? { neighbor } : {}) });
            };
            return (
              <article className="manual-draft-row" key={draft.id} aria-labelledby={rowId}>
                <div className="manual-draft-facts">
                  {draft.fields.game && <GameChip game={draft.fields.game} />}
                  <h3 id={rowId}>
                    <DraftCatalogName draft={draft} name="origin" /> →{" "}
                    <DraftCatalogName draft={draft} name="destination" />
                  </h3>
                  <p>
                    {t("cargo")} · <DraftCatalogName draft={draft} name="cargo" />
                  </p>
                  <p className="muted">
                    {t("draftUpdated")}{" "}
                    <time dateTime={draft.updatedAt}>
                      {formatUtc(draft.updatedAt, locale, timezone)}
                    </time>
                    {" · "}
                    {timezone}
                  </p>
                </div>
                <div className="trip-actions manual-draft-actions">
                  <Button asChild variant="outline">
                    <Link
                      id={`draft-resume-${draft.id}`}
                      to={
                        draft.submittedReportId
                          ? `/account/reports/${draft.submittedReportId}/edit`
                          : `/account/reports/drafts/${draft.id}`
                      }
                    >
                      {t(draft.submittedReportId ? "viewReport" : "useDraft")}
                    </Link>
                  </Button>
                  {draft.state === "editing" && (
                    <DeleteDraft
                      id={draft.id}
                      etag={`"v${draft.version}"`}
                      descriptionId={rowId}
                      onDeleted={() => setFeedback("draftDeleted")}
                      onConflict={() => setFeedback("draftDeleteConflict")}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {(list?.nextCursor || pages.hasPrevious) && (
        <Pager pages={pages} nextCursor={list?.nextCursor} />
      )}
    </section>
  );
}

function DraftCatalogName({
  draft,
  name,
}: {
  draft: DTO["ManualDraft"];
  name: "origin" | "destination" | "cargo";
}) {
  const { t } = useTranslation("trips");
  const value = draft.fields[name];
  if (!value) return t("notSpecified");
  if (value.status === "unresolved") return value.label;
  return <CatalogName value={draft.labels?.[name] ?? null} />;
}

export function ReportsPage() {
  const { t } = useTranslation("trips");
  const session = useSession();
  const [search] = useSearchParams();
  const editingOnly = search.get("state") === "editing";
  const enabled = !!session.self?.capabilities.includes("trips.submit_own");
  const first = useManualDrafts(enabled, null, editingOnly);
  return enabled ? (
    <div className="stack trip-page">
      <div className="trip-actions">
        <Button asChild>
          <Link to="/account/reports/new">{t("newReport")}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/account/trips">{t("back")}</Link>
        </Button>
      </div>
      <DraftList
        key={editingOnly ? "editing" : "all"}
        first={first}
        headingLevel={1}
        headingTitle={t(editingOnly ? "editingDrafts" : "drafts")}
        editingOnly={editingOnly}
      />
    </div>
  ) : (
    <Card>
      <p>{t("forbidden")}</p>
    </Card>
  );
}
