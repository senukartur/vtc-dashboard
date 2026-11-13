// Shared cursor paging for server lists: the query-string builder, the cursor stack per filter
// set, 409 cursor recovery and TanStack placeholder data that keeps the previous page.
import { useState } from "react";

export type QueryValue = string | number | boolean | null | undefined;

/** URL query for a list request; null, undefined and "" are never sent. */
export function queryString(params: Record<string, QueryValue>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.toString();
}

/**
 * Default rejection test: an error object carrying a numeric `status` of 409. List endpoints
 * answer 409 `VERSION_CONFLICT` for every cursor they no longer accept (tampered, expired,
 * signed with a rotated key, or issued for other filters or another member).
 */
export function cursorRejected(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 409
  );
}

export type CursorPagesState = { key: string; cursor: string | null; previous: (string | null)[] };
/** Every action names the filter key it was issued for; another key starts at its first page. */
export type CursorPagesAction =
  | { type: "next"; key: string; cursor: string }
  | { type: "previous"; key: string }
  | { type: "restart"; key: string };

export function firstPage(key: string): CursorPagesState {
  return { key, cursor: null, previous: [] };
}

export function cursorPagesReducer(
  state: CursorPagesState,
  action: CursorPagesAction,
): CursorPagesState {
  const current = state.key === action.key ? state : firstPage(action.key);
  switch (action.type) {
    case "next":
      return {
        key: current.key,
        cursor: action.cursor,
        previous: [...current.previous, current.cursor],
      };
    case "previous":
      return current.previous.length
        ? {
            key: current.key,
            cursor: current.previous.at(-1) ?? null,
            previous: current.previous.slice(0, -1),
          }
        : current;
    case "restart":
      return firstPage(action.key);
  }
}

export interface CursorPages {
  readonly cursor: string | null;
  /** 1-based page number within the current filter set. */
  readonly page: number;
  readonly hasPrevious: boolean;
  next(cursor: string): void;
  previous(): void;
  restart(): void;
  /**
   * Call during render with the page query's error. When the server rejected a non-null cursor,
   * restarts once at the first page of the same filters, so the error never renders and the
   * first page is requested only once. Returns true when it restarted.
   */
  recover(error: unknown): boolean;
}

/**
 * Cursor stack for one paged list. `filterKey` holds the effective filters, sort and locale
 * (never the cursor or page size); a new key starts at the first page during the same render.
 */
export function useCursorPages(
  filterKey: string,
  options: { rejects?: (error: unknown) => boolean } = {},
): CursorPages {
  const [state, setState] = useState<CursorPagesState>(() => firstPage(filterKey));
  const view = state.key === filterKey ? state : firstPage(filterKey);
  if (state.key !== filterKey) setState(firstPage(filterKey));
  const rejects = options.rejects ?? cursorRejected;
  const dispatch = (action: CursorPagesAction) =>
    setState((current) => cursorPagesReducer(current, action));
  return {
    cursor: view.cursor,
    page: view.previous.length + 1,
    hasPrevious: view.previous.length > 0,
    next: (cursor) => dispatch({ type: "next", key: filterKey, cursor }),
    previous: () => dispatch({ type: "previous", key: filterKey }),
    restart: () => dispatch({ type: "restart", key: filterKey }),
    recover(error) {
      if (!view.cursor || !rejects(error)) return false;
      setState(firstPage(filterKey));
      return true;
    },
  };
}

/**
 * TanStack `placeholderData`: keep the previous page while the next one loads, but only when
 * every query-key part except the request path at `pageIndex` is identical. Identity, session,
 * capability, language or schema changes therefore never reuse rows from another scope.
 */
export function keepPreviousPage(key: readonly unknown[], pageIndex: number) {
  return <T>(
    previous: T | undefined,
    previousQuery?: { queryKey: readonly unknown[] },
  ): T | undefined => {
    const other = previousQuery?.queryKey;
    if (previous === undefined || !other || other.length !== key.length) return undefined;
    return other.every((part, index) => index === pageIndex || Object.is(part, key[index]))
      ? previous
      : undefined;
  };
}
