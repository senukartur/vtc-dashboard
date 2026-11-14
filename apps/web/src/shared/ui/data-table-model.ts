// Pure DataTable logic: header sort state, the phone sort select, the body state and the footer
// summary. Rendering lives in DataTable.tsx and pager.tsx.

export type SortDirection = "asc" | "desc";
export type SortState<K extends string = string> = { key: K; direction: SortDirection };
/** A column the API can sort; `options` are the complete phone-select labels per direction. */
export type SortableColumn<K extends string = string> = {
  key: K;
  defaultDirection: SortDirection;
  options: Record<SortDirection, string>;
};

/** Clicking the active column flips its direction; another column starts in its default. */
export function nextSort<K extends string>(
  current: SortState<K>,
  column: { key: K; defaultDirection: SortDirection },
): SortState<K> {
  if (current.key !== column.key) return { key: column.key, direction: column.defaultDirection };
  return { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** `aria-sort` of a header; undefined means the column is not sortable. */
export function ariaSort(
  current: SortState | undefined,
  key: string | undefined,
): "ascending" | "descending" | "none" | undefined {
  if (key === undefined) return undefined;
  if (!current || current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}

/** Phone select options: each sortable column in its default direction first. */
export function sortOptions(
  columns: readonly { sort?: SortableColumn | undefined }[],
): { value: string; label: string }[] {
  return columns.flatMap(({ sort }) => {
    if (!sort) return [];
    const other: SortDirection = sort.defaultDirection === "asc" ? "desc" : "asc";
    return [sort.defaultDirection, other].map((direction) => ({
      value: `${sort.key}:${direction}`,
      label: sort.options[direction],
    }));
  });
}

/** Parses a `key:direction` option; unknown directions, and keys outside `keys`, give null. */
export function parseSortOption(value: string, keys?: readonly string[]): SortState | null {
  const separator = value.lastIndexOf(":");
  if (separator < 1) return null;
  const key = value.slice(0, separator),
    direction = value.slice(separator + 1);
  if (direction !== "asc" && direction !== "desc") return null;
  if (keys && !keys.includes(key)) return null;
  return { key, direction };
}

export type BodyState = "loading" | "error" | "empty-filtered" | "empty" | "rows";

export function bodyState(input: {
  status: "loading" | "error" | "ready";
  rowCount: number;
  filtered: boolean;
}): BodyState {
  if (input.status !== "ready") return input.status;
  if (input.rowCount > 0) return "rows";
  return input.filtered ? "empty-filtered" : "empty";
}

/** "From–to of total" when the API returns a total, otherwise the 1-based page number. */
export function pageSummary(input: {
  page: number;
  pageSize: number;
  count: number;
  total?: number | undefined;
}): { kind: "range"; from: number; to: number; total: number } | { kind: "page"; page: number } {
  if (input.total === undefined) return { kind: "page", page: input.page };
  const offset = (input.page - 1) * input.pageSize;
  return input.count > 0
    ? { kind: "range", from: offset + 1, to: offset + input.count, total: input.total }
    : { kind: "range", from: 0, to: 0, total: input.total };
}
