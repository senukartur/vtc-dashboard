import { utcDateTime } from "@vtc/db";
import { and, type Column, gt, or, type SQL, sql } from "drizzle-orm";
import type { DirectoryPosition } from "./pagination.js";
import { identityError } from "./service.js";

export const directorySorts = ["nickname", "distance30d", "trips30d", "lastTrip"] as const;
export type DirectorySort = (typeof directorySorts)[number];
export type DirectoryOrder = "asc" | "desc";
export const DIRECTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Selected sort keys. Activity keys exist only when the Trips-backed activity port is wired. */
export interface DirectoryKeys {
  id: Column;
  nickname: Column;
  trips?: SQL;
  distance?: SQL;
  last?: SQL;
}

export const activitySort = (sort: DirectorySort | undefined): boolean =>
  sort === "distance30d" || sort === "trips30d" || sort === "lastTrip";

/**
 * Effective order: asc for nickname, desc for the activity sorts. An order without a sort is
 * rejected because the omitted sort is the fixed ascending member ID order.
 */
export function directoryOrder(
  sort: string | undefined,
  order: string | undefined,
): DirectoryOrder | undefined {
  if (sort !== undefined && !directorySorts.includes(sort as DirectorySort))
    throw identityError(422);
  if (order !== undefined && order !== "asc" && order !== "desc") throw identityError(422);
  if (sort === undefined) {
    if (order !== undefined) throw identityError(422);
    return undefined;
  }
  return (order as DirectoryOrder | undefined) ?? (sort === "nickname" ? "asc" : "desc");
}

function key(sort: DirectorySort, keys: DirectoryKeys): SQL | Column {
  const selected =
    sort === "nickname"
      ? keys.nickname
      : sort === "trips30d"
        ? keys.trips
        : sort === "distance30d"
          ? keys.distance
          : keys.last;
  if (!selected) throw identityError(422);
  return selected;
}

// Identifiers are fixed here; only cursor values are bound parameters.
const direction = (order: DirectoryOrder) => sql.raw(order === "asc" ? "ASC" : "DESC");

/** ORDER BY for the keyset, always ending with ascending member ID. */
/** Select-list aliases of the activity facts; ORDER BY references them instead of the subqueries. */
export const directoryActivityAliases = {
  trips: "directory_trips",
  distance: "directory_distance",
  last: "directory_last",
} as const;

export function directoryOrderBy(
  sort: DirectorySort | undefined,
  order: DirectoryOrder | undefined,
  keys: DirectoryKeys,
): SQL[] {
  const id = sql`${keys.id} ASC`;
  if (!sort || !order) return [id];
  const value = key(sort, keys);
  // Members without an accepted trip sort last for lastTrip in either order.
  if (sort === "lastTrip")
    return [sql`(${value} IS NULL) ASC`, sql`${value} ${direction(order)}`, id];
  return [sql`${value} ${direction(order)}`, id];
}

function bound(sort: DirectorySort, value: string | number): SQL {
  if (sort === "distance30d") return sql`CAST(${String(value)} AS DECIMAL(65,18))`;
  if (sort === "lastTrip") return sql`CAST(${utcDateTime(String(value))} AS DATETIME(3))`;
  return sql`${value}`;
}

/** Rows strictly after the cursor position in the directory order. */
export function directoryAfter(
  sort: DirectorySort | undefined,
  order: DirectoryOrder | undefined,
  keys: DirectoryKeys,
  after: DirectoryPosition,
): SQL | undefined {
  const later = gt(keys.id, after.id);
  if (!sort || !order) return later;
  const value = key(sort, keys);
  const beyond = order === "asc" ? sql`>` : sql`<`;
  if (sort === "lastTrip") {
    if (after.value === null) return and(sql`${value} IS NULL`, later);
    const position = bound(sort, after.value);
    return or(
      sql`${value} IS NULL`,
      sql`${value} ${beyond} ${position}`,
      and(sql`${value} = ${position}`, later),
    );
  }
  if (after.value === null) throw identityError(409, "VERSION_CONFLICT");
  const position = bound(sort, after.value);
  return or(sql`${value} ${beyond} ${position}`, and(sql`${value} = ${position}`, later));
}

/** Cursor position of a returned row for the selected sort. */
export function directoryPosition(
  sort: DirectorySort | undefined,
  row: {
    id: string;
    nickname: string;
    trips?: number;
    distance?: string;
    last?: string | null;
  },
): DirectoryPosition {
  switch (sort) {
    case undefined:
      return { id: row.id, value: null };
    case "nickname":
      return { id: row.id, value: row.nickname };
    case "trips30d":
      return { id: row.id, value: row.trips ?? 0 };
    case "distance30d":
      return { id: row.id, value: row.distance ?? "0" };
    case "lastTrip":
      return { id: row.id, value: row.last ?? null };
  }
}
