import { describe, expect, test } from "vitest";
import {
  QualificationFailure,
  qualificationCursorRejected,
} from "../../apps/web/src/features/qualifications/transport.ts";
import { TripFailure } from "../../apps/web/src/features/trips/transport.ts";
import {
  type CursorPagesState,
  cursorPagesReducer,
  cursorRejected,
  firstPage,
  keepPreviousPage,
  queryString,
} from "../../apps/web/src/shared/paging.ts";

const page = (state: CursorPagesState) => ({
  cursor: state.cursor,
  page: state.previous.length + 1,
  hasPrevious: state.previous.length > 0,
});

describe("cursor pages", () => {
  test("next and previous walk the cursor stack and restart returns to page one", () => {
    let state = firstPage("scope=mine");
    expect(page(state)).toEqual({ cursor: null, page: 1, hasPrevious: false });
    state = cursorPagesReducer(state, { type: "next", key: "scope=mine", cursor: "c2" });
    state = cursorPagesReducer(state, { type: "next", key: "scope=mine", cursor: "c3" });
    expect(page(state)).toEqual({ cursor: "c3", page: 3, hasPrevious: true });
    state = cursorPagesReducer(state, { type: "previous", key: "scope=mine" });
    expect(page(state)).toEqual({ cursor: "c2", page: 2, hasPrevious: true });
    state = cursorPagesReducer(state, { type: "previous", key: "scope=mine" });
    expect(page(state)).toEqual({ cursor: null, page: 1, hasPrevious: false });
    // Previous on the first page is a no-op.
    expect(cursorPagesReducer(state, { type: "previous", key: "scope=mine" })).toBe(state);
    state = cursorPagesReducer(state, { type: "next", key: "scope=mine", cursor: "c2" });
    state = cursorPagesReducer(state, { type: "restart", key: "scope=mine" });
    expect(state).toEqual(firstPage("scope=mine"));
  });

  test("an action for another filter key starts from that key's first page", () => {
    let state = firstPage("scope=mine");
    state = cursorPagesReducer(state, { type: "next", key: "scope=mine", cursor: "c2" });
    state = cursorPagesReducer(state, { type: "next", key: "scope=mine", cursor: "c3" });
    // A late "next" from the old filters must not carry their stack into the new ones.
    const next = cursorPagesReducer(state, { type: "next", key: "scope=all", cursor: "x2" });
    expect(next).toEqual({ key: "scope=all", cursor: "x2", previous: [null] });
    expect(cursorPagesReducer(state, { type: "previous", key: "scope=all" })).toEqual(
      firstPage("scope=all"),
    );
  });

  test("only a 409 answer counts as a rejected cursor", () => {
    expect(cursorRejected(new TripFailure("conflict", 409))).toBe(true);
    expect(cursorRejected(new TripFailure("invalid", 400))).toBe(false);
    expect(cursorRejected(new TripFailure("forbidden", 403))).toBe(false);
    expect(cursorRejected(new Error("network"))).toBe(false);
    expect(cursorRejected({ status: "409" })).toBe(false);
    expect(cursorRejected(null)).toBe(false);
    expect(cursorRejected(undefined)).toBe(false);
  });

  test("a qualification setup conflict is not a rejected cursor", () => {
    expect(qualificationCursorRejected(new QualificationFailure("conflict", 409))).toBe(true);
    expect(qualificationCursorRejected(new QualificationFailure("conflict", 409, null, true))).toBe(
      false,
    );
    expect(qualificationCursorRejected(new QualificationFailure("invalid", 400))).toBe(false);
    expect(qualificationCursorRejected(new TripFailure("conflict", 409))).toBe(false);
  });
});

describe("keeping the previous page", () => {
  const key = (overrides: Partial<Record<number, unknown>> = {}) => {
    const base: unknown[] = [
      "trip-workspace",
      "member-a",
      3,
      7,
      "trips.read",
      "en",
      "/api/trips?scope=mine",
      "ListTrips",
    ];
    for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
    return base;
  };
  const rows = { data: ["row"] };

  test("rows stay while only the request path changes", () => {
    const keep = keepPreviousPage(key({ 6: "/api/trips?scope=mine&cursor=c2" }), 6);
    expect(keep(rows, { queryKey: key() })).toBe(rows);
  });

  test("rows are dropped for another member, session, capability, language or schema", () => {
    const keep = keepPreviousPage(key({ 6: "/api/trips?scope=mine&cursor=c2" }), 6);
    for (const [index, value] of [
      [1, "member-b"],
      [2, 4],
      [3, 8],
      [4, "trips.read,trips.review"],
      [5, "ru"],
      [7, "ListReviewQueue"],
    ] as const)
      expect(keep(rows, { queryKey: key({ [index]: value }) }), String(index)).toBeUndefined();
    expect(keep(rows, { queryKey: key().slice(0, 7) })).toBeUndefined();
    expect(keep(rows)).toBeUndefined();
    expect(keep(undefined, { queryKey: key() })).toBeUndefined();
  });
});

test("list queries never send empty values", () => {
  expect(queryString({ scope: "mine", cursor: null, source: undefined, q: "", limit: 25 })).toBe(
    "scope=mine&limit=25",
  );
  expect(queryString({ q: "Fixture Hauler 1", archived: false })).toBe(
    "q=Fixture+Hauler+1&archived=false",
  );
});
