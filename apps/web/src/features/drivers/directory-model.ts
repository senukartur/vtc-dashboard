// Pure view model of the drivers directory (VTC-145): validated URL state, the effective sort with
// its trips-off fallback, request paths, the cursor filter key, the cell values and the access
// panel links (VTC-160).
import { queryString } from "../../shared/paging.js";
import { normalizeSearch } from "../admin/members-model.js";
import type { DTO } from "./transport.js";

export type DirectoryTab = "active" | "invited" | "former";
export type DirectoryRole = DTO["MemberStage4DirectoryEntry"]["roles"][number];
export type DirectorySort = "nickname" | "distance30d" | "trips30d" | "lastTrip";
export type SortOrder = "asc" | "desc";
export type InvitationState = "active" | "expired";
export type DirectoryEntry = DTO["MemberStage4DirectoryEntry"];
export type DirectoryList = DTO["MemberStage4DirectoryList"];

export const DIRECTORY_PAGE_SIZE = 25;
/** Display order of the role filter: the most senior role first. */
export const directoryRoles: readonly DirectoryRole[] = [
  "director",
  "deputy_director",
  "dispatcher",
  "driver",
  "trainee",
];
export const directorySorts: readonly DirectorySort[] = [
  "nickname",
  "distance30d",
  "trips30d",
  "lastTrip",
];
/** URL parameters only the In company tab keeps; leaving it drops them. */
export const activeOnlyParams = ["role", "ets2Level", "atsLevel"] as const;
export const activitySorts: readonly DirectorySort[] = ["distance30d", "trips30d", "lastTrip"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated URL state. Invalid values are ignored; the cursor is never part of the URL. */
export type DirectoryUrl = {
  tab: DirectoryTab;
  search: string | null;
  /**
   * Role and level filters apply only to the In company tab: deactivation clears access roles, so
   * a role filter on Left could only ever match nobody.
   */
  role: DirectoryRole | null;
  ets2Level: string | null;
  atsLevel: string | null;
  /** Explicit sort from the URL; null keeps the tab default. */
  sort: DirectorySort | null;
  order: SortOrder | null;
  state: InvitationState;
  /**
   * Member whose access panel is open (VTC-160): a lowercase UUID, never on Invited. The page
   * honours it only with members.manage.
   */
  access: string | null;
};

/** `canInvite` is applications.manage: without it `tab=invited` silently falls back. */
export function parseDirectoryUrl(params: URLSearchParams, canInvite: boolean): DirectoryUrl {
  const value = params.get("tab");
  const tab: DirectoryTab =
    value === "former" ? "former" : value === "invited" && canInvite ? "invited" : "active";
  const role = params.get("role");
  const sort = params.get("sort");
  const order = params.get("order");
  const access = params.get("access");
  const active = tab === "active";
  const level = (name: string) => {
    const id = params.get(name);
    return active && id && uuid.test(id) ? id.toLowerCase() : null;
  };
  const explicitSort = directorySorts.includes(sort as DirectorySort)
    ? (sort as DirectorySort)
    : null;
  return {
    tab,
    search: normalizeSearch(params.get("search") ?? ""),
    role: active && directoryRoles.includes(role as DirectoryRole) ? (role as DirectoryRole) : null,
    ets2Level: level("ets2Level"),
    atsLevel: level("atsLevel"),
    sort: explicitSort,
    order: explicitSort && (order === "asc" || order === "desc") ? order : null,
    state: params.get("state") === "expired" ? "expired" : "active",
    access: tab !== "invited" && access && uuid.test(access) ? access.toLowerCase() : null,
  };
}

/** The API default order of a sort: ascending nicknames, newest/largest activity first. */
export function defaultOrder(sort: DirectorySort): SortOrder {
  return sort === "nickname" ? "asc" : "desc";
}

/** Tab default: In company by 30-day distance, Former by the latest accepted trip. */
export function tabDefaultSort(tab: DirectoryTab): DirectorySort {
  return tab === "former" ? "lastTrip" : "distance30d";
}

export type EffectiveSort = { sort: DirectorySort; order: SortOrder; implicit: boolean };

/**
 * The sort the request sends. An explicit URL sort always wins. Otherwise the tab default, or
 * nicknames when activity is unavailable (Trips off answers activity sorts with 422).
 */
export function effectiveSort(
  tab: DirectoryTab,
  url: Pick<DirectoryUrl, "sort" | "order">,
  activityUnavailable: boolean,
): EffectiveSort {
  if (url.sort)
    return { sort: url.sort, order: url.order ?? defaultOrder(url.sort), implicit: false };
  const sort = activityUnavailable ? "nickname" : tabDefaultSort(tab);
  return { sort, order: defaultOrder(sort), implicit: true };
}

/** URL parameters for a chosen sort: none when it equals the implicit default of the tab. */
export function sortParams(
  next: { sort: DirectorySort; order: SortOrder },
  implicitDefault: { sort: DirectorySort; order: SortOrder },
): { sort: string | null; order: string | null } {
  if (next.sort === implicitDefault.sort && next.order === implicitDefault.order)
    return { sort: null, order: null };
  return { sort: next.sort, order: next.order === defaultOrder(next.sort) ? null : next.order };
}

/** Request parameters of a directory tab, without the cursor; also the cursor filter key. */
export function directoryParams(url: DirectoryUrl, sort: EffectiveSort) {
  const active = url.tab === "active";
  return {
    limit: DIRECTORY_PAGE_SIZE,
    status: url.tab === "former" ? "former" : "active",
    search: url.search,
    role: active ? url.role : null,
    ets2Level: active ? url.ets2Level : null,
    atsLevel: active ? url.atsLevel : null,
    sort: sort.sort,
    order: sort.order,
  };
}

export function directoryPath(url: DirectoryUrl, sort: EffectiveSort, cursor: string | null) {
  return `/members?${queryString({ ...directoryParams(url, sort), cursor })}`;
}

/** Light read that keeps the company-wide counters on the Invited tab. */
export const countsPath = "/members?limit=1&sort=nickname";

/** Cursor stack key: tab plus every request parameter except the cursor. */
export function directoryFilterKey(url: DirectoryUrl, sort: EffectiveSort) {
  return `${url.tab}:${queryString(directoryParams(url, sort))}`;
}

/** Filters that narrow the list (not the sort): they enable the filtered empty state. */
export function filtersActive(url: DirectoryUrl) {
  return !!(url.search || url.role || url.ets2Level || url.atsLevel);
}

export type DirectoryFailure = "invalid" | "error";

/** 400/422 means a filter or sort the server no longer accepts; anything else is retryable. */
export function directoryFailure(error: unknown): DirectoryFailure {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: unknown }).status
      : 0;
  return status === 422 || status === 400 ? "invalid" : "error";
}

/** Level cell: absent levels (no Qualifications) are unavailable; null means no current level. */
export type LevelView =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "level"; name: string; position: number };

export function levelView(entry: DirectoryEntry, game: "ets2" | "ats"): LevelView {
  if (!entry.levels) return { kind: "unavailable" };
  const level = entry.levels[game];
  return level ? { kind: "level", name: level.name, position: level.position } : { kind: "none" };
}

/** Activity cells: absent (Trips off) is unavailable, never zero. */
export function activityView(
  entry: DirectoryEntry,
): { kind: "unavailable" } | { kind: "value"; trips: number; distanceM: string } {
  return entry.last30Days
    ? {
        kind: "value",
        trips: entry.last30Days.acceptedTrips,
        distanceM: entry.last30Days.actualDistanceM,
      }
    : { kind: "unavailable" };
}

/** Last trip: undefined is unavailable (Trips off), null means no accepted trip yet. */
export function lastTripView(
  value: string | null | undefined,
): { kind: "unavailable" } | { kind: "none" } | { kind: "date"; iso: string } {
  if (value === undefined) return { kind: "unavailable" };
  return value === null ? { kind: "none" } : { kind: "date", iso: value };
}

/** Header counters: each part only when the response carries it; no plurals. */
export function headerParts(
  counts: DTO["MemberStage4DirectoryCounts"] | undefined,
): { active: number; drove?: number } | null {
  if (!counts) return null;
  return counts.droveLast30Days === undefined
    ? { active: counts.active }
    : { active: counts.active, drove: counts.droveLast30Days };
}

/** The access panel marker of a history entry, honoured only for the same viewer and session. */
export function isManagedAccess(
  value: unknown,
  viewerId: string | null,
  generation: number,
): value is { memberId: string } {
  if (!value || typeof value !== "object" || !viewerId) return false;
  const marker = value as Record<string, unknown>;
  return (
    typeof marker.memberId === "string" &&
    marker.viewerId === viewerId &&
    marker.generation === generation
  );
}

/** The directory with this member's access panel open, on Left for a former member. */
export function driverAccessHref(member: { id: string; formerMember: boolean }) {
  return `/account/drivers?${new URLSearchParams({
    access: member.id,
    ...(member.formerMember ? { tab: "former" } : {}),
  })}`;
}

/** The Members administration page, filtered to this member (members.manage only). */
export function accessHref(member: { nickname: string; formerMember: boolean }) {
  const search = normalizeSearch(member.nickname);
  return `/account/admin/members?${new URLSearchParams({
    status: member.formerMember ? "inactive" : "active",
    ...(search ? { search } : {}),
  })}`;
}
