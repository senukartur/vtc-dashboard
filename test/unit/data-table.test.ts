import { describe, expect, test } from "vitest";
import {
  ariaSort,
  bodyState,
  nextSort,
  pageSummary,
  parseSortOption,
  sortOptions,
} from "../../apps/web/src/shared/ui/data-table-model.ts";

const completion = {
  key: "completion",
  defaultDirection: "desc",
  options: { desc: "Newest first", asc: "Oldest first" },
} as const;
const driver = {
  key: "driver",
  defaultDirection: "asc",
  options: { asc: "Driver, A to Z", desc: "Driver, Z to A" },
} as const;

describe("header sorting", () => {
  test("the active column flips; another column starts in its default direction", () => {
    expect(nextSort({ key: "completion", direction: "desc" }, completion)).toEqual({
      key: "completion",
      direction: "asc",
    });
    expect(nextSort({ key: "completion", direction: "asc" }, completion)).toEqual({
      key: "completion",
      direction: "desc",
    });
    expect(nextSort({ key: "completion", direction: "desc" }, driver)).toEqual({
      key: "driver",
      direction: "asc",
    });
    expect(nextSort({ key: "driver", direction: "asc" }, completion)).toEqual({
      key: "completion",
      direction: "desc",
    });
  });

  test("aria-sort names the active direction, none for other sortable and nothing otherwise", () => {
    expect(ariaSort({ key: "completion", direction: "asc" }, "completion")).toBe("ascending");
    expect(ariaSort({ key: "completion", direction: "desc" }, "completion")).toBe("descending");
    expect(ariaSort({ key: "completion", direction: "desc" }, "driver")).toBe("none");
    expect(ariaSort(undefined, "driver")).toBe("none");
    expect(ariaSort({ key: "completion", direction: "desc" }, undefined)).toBeUndefined();
  });

  test("phone sort options list each sortable column, default direction first, and round-trip", () => {
    const options = sortOptions([{}, { sort: completion }, { sort: driver }]);
    expect(options).toEqual([
      { value: "completion:desc", label: "Newest first" },
      { value: "completion:asc", label: "Oldest first" },
      { value: "driver:asc", label: "Driver, A to Z" },
      { value: "driver:desc", label: "Driver, Z to A" },
    ]);
    for (const option of options) {
      const parsed = parseSortOption(option.value, ["completion", "driver"]);
      expect(parsed && `${parsed.key}:${parsed.direction}`).toBe(option.value);
    }
    expect(sortOptions([{}, {}])).toEqual([]);
  });

  test("unknown sort options are rejected", () => {
    for (const value of ["", "completion", ":asc", "completion:up", "completion:ASC"])
      expect(parseSortOption(value), value).toBeNull();
    expect(parseSortOption("distance:desc", ["completion"])).toBeNull();
    expect(parseSortOption("distance:desc")).toEqual({ key: "distance", direction: "desc" });
  });
});

describe("body state and footer", () => {
  test("every body state", () => {
    expect(bodyState({ status: "loading", rowCount: 3, filtered: true })).toBe("loading");
    expect(bodyState({ status: "error", rowCount: 3, filtered: false })).toBe("error");
    expect(bodyState({ status: "ready", rowCount: 0, filtered: true })).toBe("empty-filtered");
    expect(bodyState({ status: "ready", rowCount: 0, filtered: false })).toBe("empty");
    expect(bodyState({ status: "ready", rowCount: 2, filtered: true })).toBe("rows");
  });

  test("the footer shows a range with a total and the page number without one", () => {
    expect(pageSummary({ page: 1, pageSize: 25, count: 25, total: 142 })).toEqual({
      kind: "range",
      from: 1,
      to: 25,
      total: 142,
    });
    // A partial last page ends at the total.
    expect(pageSummary({ page: 3, pageSize: 25, count: 10, total: 60 })).toEqual({
      kind: "range",
      from: 51,
      to: 60,
      total: 60,
    });
    expect(pageSummary({ page: 1, pageSize: 25, count: 0, total: 0 })).toEqual({
      kind: "range",
      from: 0,
      to: 0,
      total: 0,
    });
    expect(pageSummary({ page: 3, pageSize: 25, count: 25 })).toEqual({ kind: "page", page: 3 });
    expect(pageSummary({ page: 1, pageSize: 25, count: 0, total: undefined })).toEqual({
      kind: "page",
      page: 1,
    });
  });
});
