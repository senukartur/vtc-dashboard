// Drivers directory (VTC-145): In company / Invited / Left tabs with company-wide counters, URL
// filters, server sorts and cursor pages over listMembers. Invitations need applications.manage;
// the Access buttons need members.manage and open the access panel over the list (VTC-160).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, formatDecimal, formatUtc, type Locale } from "../../shared/formatting.js";
import { useCursorPages } from "../../shared/paging.js";
import { DataTable } from "../../shared/ui/DataTable.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { InvitationsList, useInvitationCount } from "../admin/InvitationsTab.js";
import { useQualificationQuery } from "../qualifications/queries.js";
import { AccessPanel } from "./AccessPanel.js";
import {
  DirectoryToolbar,
  directoryColumns,
  InfoHint,
  useDirectorySearch,
  useMinuteNow,
} from "./directory-components.js";
import {
  activeOnlyParams,
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
  isManagedAccess,
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
 * follows a 422 on that implicit default (requeried once by nickname), "retry" asks for the
 * default again after the fallback page proved Trips on (that 422 came from a stale filter; a
 * second one shows the invalid-filters state instead of falling back again), "off" a page
 * without `windowEndsAt` (Trips is not configured).
 */
type Activity = "unknown" | "fallback" | "retry" | "off";

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
  const activityUnavailable = activity === "fallback" || activity === "off";
  const sort = effectiveSort(url.tab, url, activityUnavailable);

  const pages = useCursorPages(directoryFilterKey(url, sort));
  const query = useDirectoryList(directoryPath(url, sort, pages.cursor), !!listTab, true);
  // The Invited tab keeps the company-wide counters with the smallest directory page.
  const countsQuery = useDirectoryList(countsPath, !listTab);
  const invitedCount = useInvitationCount(canInvite);
  const levelReads = {
    ets2: useQualificationQuery(
      "/qualification-levels?game=ets2",
      "EnvelopeQualificationLevelList",
      listTab === "active",
    ),
    ats: useQualificationQuery(
      "/qualification-levels?game=ats",
      "EnvelopeQualificationLevelList",
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
  // The next real page settles a fallback or retry: with the window Trips is on, without it off.
  if (list && !query.isPlaceholderData) {
    if (!list.windowEndsAt) {
      if (activity !== "off") setActivity("off");
    } else if (activity === "fallback") setActivity("retry");
    else if (activity === "retry" && sort.implicit && sort.sort !== "nickname")
      setActivity("unknown");
  }
  const activitySortable = activity !== "off" && !(list && !list.windowEndsAt);

  // Counters stay while another tab loads; they belong to this viewer and session only.
  const scope = `${session.self?.member.id}:${session.generation}`;
  const fresh = (listTab ? list : countsQuery.data)?.statusCounts;
  const [kept, setKept] = useState<{ scope: string; counts: typeof fresh }>();
  if (fresh && (kept?.counts !== fresh || kept?.scope !== scope)) setKept({ scope, counts: fresh });
  const counts = fresh ?? (kept?.scope === scope ? kept.counts : undefined);
  const parts = headerParts(counts);
  const windowEndsAt = (listTab ? list : countsQuery.data)?.windowEndsAt;

  // The access panel opens only with members.manage. Once open, a lost capability (a 403 that
  // refreshed the session) keeps the panel to explain it instead of closing it silently. The
  // history entry remembers the member opened with the capability, for this viewer and session
  // generation only, since the session refresh can remount this page.
  const location = useLocation();
  const viewerId = session.self?.member.id ?? null;
  const generation = session.generation;
  const marker = (location.state as { managedAccess?: unknown } | null)?.managedAccess;
  const managed = isManagedAccess(marker, viewerId, generation) ? marker.memberId : null;
  const accessId = url.access && (canManage || managed === url.access) ? url.access : null;
  useEffect(() => {
    if (!canManage || !url.access || !viewerId || managed === url.access) return;
    const state = location.state;
    setParams(new URLSearchParams(window.location.search), {
      replace: true,
      state: {
        ...(state && typeof state === "object" ? state : {}),
        managedAccess: { memberId: url.access, viewerId, generation },
      },
    });
  }, [canManage, url.access, viewerId, generation, managed, location.state, setParams]);
  const now = useMinuteNow();

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
      next.delete("access");
      if (tab !== "active") for (const name of activeOnlyParams) next.delete(name);
      if (tab !== "invited") next.delete("state");
    });
  }
  function changeSort(next: { key: DirectorySort; direction: SortOrder }) {
    const implicit = effectiveSort(url.tab, { sort: null, order: null }, activityUnavailable);
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
    if (activity === "fallback" || activity === "retry") setActivity("unknown");
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
    const levels = read.data?.data.data.levels;
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
      now,
      onAccess: (id) => update((next) => set(next, "access", id), true),
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
          rowAttributes={(entry) => ({
            className: "drivers-row",
            ...(entry.id === accessId ? { "data-access-open": "" } : {}),
          })}
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
      {accessId && listTab && (
        <AccessPanel
          key={accessId}
          memberId={accessId}
          nickname={list?.items.find((entry) => entry.id === accessId)?.nickname}
          allowed={canManage}
          locale={locale}
          timezone={timezone}
          onClose={() => update((next) => next.delete("access"), true)}
          returnFocus={() => {
            // Back to the row's Access button when it is still on screen, else the search.
            const button = document.querySelector<HTMLElement>(
              `[data-access-member="${accessId}"]`,
            );
            (button?.isConnected && button.getClientRects().length
              ? button
              : searchRef.current
            )?.focus();
          }}
        />
      )}
    </div>
  );
}
