// Drivers directory (VTC-145): In company / Invited / Left tabs with company-wide counters, URL
// filters, server sorts and cursor pages over listMembers. Invitations need applications.manage;
// the Access links need members.manage and open the separate Members administration page.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, formatDecimal, formatUtc, type Locale } from "../../shared/formatting.js";
import { useCursorPages } from "../../shared/paging.js";
import { DataTable } from "../../shared/ui/DataTable.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { InvitationsList, useInvitationCount } from "../admin/InvitationsTab.js";
import { useQualificationQuery } from "../qualifications/queries.js";
import {
  DirectoryToolbar,
  directoryColumns,
  InfoHint,
  useDirectorySearch,
} from "./directory-components.js";
import {
  countsPath,
  DIRECTORY_PAGE_SIZE,
  type DirectorySort,
  type DirectoryTab,
  directoryFailure,
  directoryFilterKey,
  directoryPath,
  effectiveSort,
  filtersActive,
  headerParts,
  parseDirectoryUrl,
  type SortOrder,
  sortParams,
} from "./directory-model.js";
import { useDirectoryList } from "./queries.js";
import "./drivers-directory.css";

/** Gate: without company.read no directory query hook mounts, so nothing is requested. */
export function DriversPage() {
  const { t } = useTranslation("drivers");
  const session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="drivers-page">
        <header className="drivers-heading">
          <h1>{t("directory.title")}</h1>
        </header>
        <Card className="drivers-notice">
          <p>{t("states.forbidden")}</p>
        </Card>
      </div>
    );
  return <DriversDirectory />;
}

/**
 * Whether the 30-day activity can be sorted: "unknown" tries the activity default, "fallback"
 * follows a 422 on that implicit default (requeried once by nickname), "off" a page without
 * `windowEndsAt` (Trips is not configured).
 */
type Activity = "unknown" | "fallback" | "off";

function DriversDirectory() {
  const { t, i18n } = useTranslation("drivers");
  const locale: Locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const session = useSession();
  const capabilities = session.self?.capabilities ?? [];
  const canInvite = capabilities.includes("applications.manage");
  const canManage = capabilities.includes("members.manage");
  const timezone = accountTimeZone(session.self?.preferences.displayTimezone);
  const [params, setParams] = useSearchParams();
  const url = parseDirectoryUrl(params, canInvite);
  const listTab = url.tab === "invited" ? null : url.tab;
  const [activity, setActivity] = useState<Activity>("unknown");
  const sort = effectiveSort(url.tab, url, activity !== "unknown");

  const pages = useCursorPages(directoryFilterKey(url, sort));
  const query = useDirectoryList(directoryPath(url, sort, pages.cursor), !!listTab, true);
  // The Invited tab keeps the company-wide counters with the smallest directory page.
  const countsQuery = useDirectoryList(countsPath, !listTab);
  const invitedCount = useInvitationCount(canInvite);
  const levelReads = {
    ets2: useQualificationQuery(
      "/qualification-levels?game=ets2&limit=25",
      "EnvelopeListQualificationLevel",
      listTab === "active",
    ),
    ats: useQualificationQuery(
      "/qualification-levels?game=ats&limit=25",
      "EnvelopeListQualificationLevel",
      listTab === "active",
    ),
  };

  // A rejected cursor restarts the same list without rendering an error.
  pages.recover(query.error);
  const failure = query.isError ? directoryFailure(query.error) : null;
  // Trips off rejects the implicit activity default: requery once by nickname.
  if (failure === "invalid" && sort.implicit && sort.sort !== "nickname" && activity === "unknown")
    setActivity("fallback");
  const list = query.isError ? undefined : query.data;
  if (list && !query.isPlaceholderData && !list.windowEndsAt && activity !== "off")
    setActivity("off");
  const activitySortable = activity !== "off" && !(list && !list.windowEndsAt);

  // Counters stay while another tab loads; they belong to this viewer and session only.
  const scope = `${session.self?.member.id}:${session.generation}`;
  const fresh = (listTab ? list : countsQuery.data)?.statusCounts;
  const [kept, setKept] = useState<{ scope: string; counts: typeof fresh }>();
  if (fresh && (kept?.counts !== fresh || kept?.scope !== scope)) setKept({ scope, counts: fresh });
  const counts = fresh ?? (kept?.scope === scope ? kept.counts : undefined);
  const parts = headerParts(counts);
  const windowEndsAt = (listTab ? list : countsQuery.data)?.windowEndsAt;

  const searchRef = useRef<HTMLInputElement>(null);
  // Use the current URL so rapid successive updates keep each other's parameters.
  function update(change: (next: URLSearchParams) => void, replace = false) {
    const next = new URLSearchParams(window.location.search);
    change(next);
    next.delete("cursor");
    setParams(next, { replace });
  }
  const set = (next: URLSearchParams, name: string, value: string | null) => {
    if (value) next.set(name, value);
    else next.delete(name);
  };
  const { draft, setDraft } = useDirectorySearch(url.search ?? "", (value) =>
    update((next) => set(next, "search", value), true),
  );
  function changeTab(value: string) {
    const tab = value as DirectoryTab;
    update((next) => {
      set(next, "tab", tab === "active" ? null : tab);
      if (tab !== "active") {
        next.delete("ets2Level");
        next.delete("atsLevel");
      }
      if (tab !== "invited") next.delete("state");
    });
  }
  function changeSort(next: { key: DirectorySort; direction: SortOrder }) {
    const implicit = effectiveSort(url.tab, { sort: null, order: null }, activity !== "unknown");
    const value = sortParams({ sort: next.key, order: next.direction }, implicit);
    update((search) => {
      set(search, "sort", value.sort);
      set(search, "order", value.order);
    });
  }
  function reset() {
    setDraft("");
    searchRef.current?.focus();
    // A fallback inferred from a 422 may have come from a stale filter: try the default again.
    if (activity === "fallback") setActivity("unknown");
    update((next) => {
      for (const name of ["search", "role", "ets2Level", "atsLevel", "sort", "order"])
        next.delete(name);
    });
  }

  const number = (value: number) => formatDecimal(String(value), locale);
  const tabs: { value: DirectoryTab; label: string; count: number | undefined }[] = [
    { value: "active", label: t("directory.tabActive"), count: counts?.active },
    ...(canInvite
      ? [{ value: "invited" as const, label: t("directory.tabInvited"), count: invitedCount }]
      : []),
    { value: "former", label: t("directory.tabFormer"), count: counts?.former },
  ];
  const levelOptions = (game: "ets2" | "ats") => {
    const read = levelReads[game];
    const levels = read.data?.data.data.items;
    // Without Qualifications the rows carry no levels and the level filter would answer 422.
    const qualificationsOff = !!list?.items.length && list.items.every((entry) => !entry.levels);
    return {
      levels,
      pending: read.isPending,
      shown: !read.isError && !qualificationsOff && (read.isPending || !!levels?.length),
    };
  };
  const filtered = filtersActive(url);

  let body = null;
  if (listTab) {
    const columns = directoryColumns({
      tab: listTab,
      selfId: session.self?.member.id,
      canManage,
      activitySortable,
      locale,
      timezone,
      t,
    });
    body = (
      <>
        <DirectoryToolbar
          tab={listTab}
          search={draft}
          searchRef={searchRef}
          onSearch={setDraft}
          role={url.role}
          ets2Level={url.ets2Level}
          atsLevel={url.atsLevel}
          levels={{ ets2: levelOptions("ets2"), ats: levelOptions("ats") }}
          onChange={(name, value) => update((next) => set(next, name, value))}
          canReset={filtered || !!draft || !!url.sort}
          onReset={reset}
        />
        <DataTable
          className="drivers-table"
          caption={t(listTab === "active" ? "directory.caption" : "directory.captionFormer")}
          columns={columns}
          rows={list?.items}
          rowKey={(entry) => entry.id}
          rowAttributes={() => ({ className: "drivers-row" })}
          cardsBelow={800}
          status={query.isError ? "error" : list ? "ready" : "loading"}
          busy={query.isPlaceholderData}
          error={
            failure === "invalid" ? (
              <span className="drivers-invalid">
                <span>{t("directory.invalid")}</span>
                <Button type="button" variant="outline" size="xs" onClick={reset}>
                  {t("directory.reset")}
                </Button>
              </span>
            ) : (
              t("directory.error")
            )
          }
          {...(failure === "invalid"
            ? {}
            : {
                onRetry: () => {
                  pages.restart();
                  if (!pages.cursor) void query.refetch();
                },
              })}
          empty={{
            message: t(listTab === "active" ? "directory.empty" : "directory.emptyFormer"),
          }}
          {...(filtered
            ? { filtered: { onReset: reset, message: t("directory.nothingFound") } }
            : {})}
          sort={{
            value: { key: sort.sort, direction: sort.order },
            onChange: changeSort,
            label: t("directory.sortLabel"),
          }}
          pagination={{ pages, nextCursor: list?.nextCursor, pageSize: DIRECTORY_PAGE_SIZE }}
          footer={<small className="drivers-footnote">{t("directory.dates", { timezone })}</small>}
        />
      </>
    );
  } else {
    body = (
      <InvitationsList
        state={url.state}
        onStateChange={(state) =>
          update((next) => set(next, "state", state === "active" ? null : state))
        }
        timezone={timezone}
      />
    );
  }

  return (
    <div className="drivers-page">
      <header className="drivers-heading">
        <h1>{t("directory.title")}</h1>
        {(parts || windowEndsAt) && (
          <p className="drivers-summary">
            {parts && (
              <span className="drivers-counts">
                {t("directory.inCompany", { active: number(parts.active) })}
                {parts.drove !== undefined &&
                  ` · ${t("directory.drove", { drove: number(parts.drove) })}`}
              </span>
            )}
            {windowEndsAt && (
              <InfoHint label={t("directory.windowHint")}>
                {t("directory.windowText", {
                  end: formatUtc(windowEndsAt, locale, timezone),
                  timezone,
                })}
              </InfoHint>
            )}
          </p>
        )}
      </header>
      <Tabs
        className="drivers-tabs"
        value={url.tab}
        onValueChange={changeTab}
        activationMode="manual"
      >
        <TabsList aria-label={t("directory.tabsLabel")}>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              aria-label={
                tab.count === undefined
                  ? undefined
                  : t("directory.tabCount", { label: tab.label, total: number(tab.count) })
              }
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="drivers-tab-count" aria-hidden="true">
                  {number(tab.count)}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="drivers-panel">
            {tab.value === url.tab && body}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
