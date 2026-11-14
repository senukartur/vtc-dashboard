// The one cabinet table: declared columns, header sorting, cursor pages and content states on
// the shared Table primitive. Server lists pass `status`, `sort` and `pagination`; small static
// tables omit them and keep the same look and phone cards.
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../cn.js";
import type { CursorPages } from "../paging.js";
import {
  ariaSort,
  bodyState,
  nextSort,
  parseSortOption,
  type SortableColumn,
  type SortDirection,
  type SortState,
  sortOptions,
} from "./data-table-model.js";
import { Pager } from "./pager.js";
import { Button, Label, Select, Table } from "./primitives.js";
import "./data-table.css";

export type DataTableColumn<Row, K extends string = string> = {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers align to the end. */
  align?: "start" | "end";
  /** Renders `<th scope="row">`, for example the day column of a chart table. */
  rowHeader?: boolean;
  /** Phone card label; defaults to the header when it is a string; false shows none. */
  cardLabel?: string | false;
  /** Class on the header and every cell of the column, for example a feature width. */
  className?: string;
  /** Only columns the API can sort. */
  sort?: SortableColumn<K>;
};

type RowAttributes = { className?: string } & Record<`data-${string}`, string | undefined>;

export type DataTableProps<Row, K extends string = string> = {
  /** Required; visually hidden unless `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  columns: readonly DataTableColumn<Row, K>[];
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  rowAttributes?: (row: Row) => RowAttributes;
  size?: "xs" | "sm";
  /** Viewport width (inclusive) at and below which rows become labelled cards. */
  cardsBelow?: 760 | 800;
  className?: string;
  tableProps?: { id?: string; tabIndex?: -1 };
  /** Server state of the rows; static tables stay "ready". */
  status?: "loading" | "error" | "ready";
  /** Previous rows stay dimmed while the next page or sort loads. */
  busy?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  skeletonRows?: number;
  empty?: { message: ReactNode; action?: ReactNode };
  /** Pass only while filters are active; `onReset` must move focus to a stable control. */
  filtered?: { onReset: () => void; message?: ReactNode };
  sort?: { value: SortState<K>; onChange: (next: SortState<K>) => void; label?: string };
  pagination?: {
    pages: CursorPages;
    nextCursor: string | null | undefined;
    pageSize: number;
    total?: number | undefined;
    label?: string;
  };
  /** Shown left of the pager, for example a note about the list. */
  footer?: ReactNode;
};

function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg
      aria-hidden="true"
      className="data-table-sort-icon"
      data-direction={direction ?? "none"}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          direction === "desc"
            ? "M12 5v14M6 13l6 6 6-6"
            : direction === "asc"
              ? "M12 19V5M6 11l6-6 6 6"
              : "M8 9l4-4 4 4M8 15l4 4 4-4"
        }
      />
    </svg>
  );
}

const skeletonWidths = [72, 56, 88, 64, 80];

export function DataTable<Row, K extends string = string>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  rowAttributes,
  size,
  cardsBelow = 760,
  className,
  tableProps,
  status = "ready",
  busy = false,
  error,
  onRetry,
  skeletonRows = 5,
  empty,
  filtered,
  sort,
  pagination,
  footer,
}: DataTableProps<Row, K>) {
  const { t } = useTranslation("core");
  const root = useRef<HTMLDivElement>(null);
  const sortId = useId();
  const state = bodyState({ status, rowCount: rows?.length ?? 0, filtered: !!filtered });
  const options = sort ? sortOptions(columns) : [];
  const keys = columns.flatMap((column) => (column.sort ? [column.sort.key] : []));
  const span = columns.length;
  // The progress line sits under the header row; phone cards hide the header, so it starts at 0.
  useLayoutEffect(() => {
    const element = root.current;
    if (!busy || !element) return;
    const head = element.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    element.style.setProperty("--data-table-head", `${head > 1 ? head : 0}px`);
  }, [busy]);
  const showPager =
    !!pagination &&
    state !== "loading" &&
    state !== "error" &&
    (state === "rows" || pagination.pages.hasPrevious || !!pagination.nextCursor);
  const label = (column: DataTableColumn<Row, K>) =>
    column.cardLabel === false
      ? null
      : (column.cardLabel ?? (typeof column.header === "string" ? column.header : null));
  return (
    <div
      ref={root}
      className={cn("data-table", className)}
      data-cards={cardsBelow}
      data-busy={busy ? "true" : undefined}
    >
      {options.length > 0 && sort && (
        <div className="data-table-sort-select">
          <Label htmlFor={sortId}>{sort.label ?? t("dataTable.sort")}</Label>
          <Select
            id={sortId}
            value={`${sort.value.key}:${sort.value.direction}`}
            onChange={(event) => {
              const next = parseSortOption(event.target.value, keys);
              if (next) sort.onChange(next as SortState<K>);
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      {state === "loading" && (
        <p role="status" className="visually-hidden">
          {t("dataTable.loading")}
        </p>
      )}
      {busy && <div className="data-table-progress" aria-hidden="true" />}
      <div className="data-table-scroll">
        <Table
          size={size}
          id={tableProps?.id}
          tabIndex={tableProps?.tabIndex}
          aria-busy={state === "loading" || busy ? true : undefined}
        >
          <caption className={captionVisible ? undefined : "visually-hidden"}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = column.sort && sort?.value.key === column.sort.key;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(column.className, column.align === "end" && "data-table-end")}
                    aria-sort={sort ? ariaSort(sort.value, column.sort?.key) : undefined}
                  >
                    {column.sort && sort ? (
                      <>
                        {/* Phone cards hide the sort button; the hidden header keeps its name. */}
                        <span className="data-table-head-text">
                          {label(column) ?? column.header}
                        </span>
                        <button
                          type="button"
                          className="data-table-sort"
                          data-active={active ? "true" : undefined}
                          onClick={() =>
                            column.sort && sort.onChange(nextSort(sort.value, column.sort))
                          }
                        >
                          {column.header}
                          <SortIcon direction={active ? sort.value.direction : null} />
                        </button>
                      </>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {state === "loading" ? (
            <tbody className="data-table-skeleton" aria-hidden="true">
              {Array.from({ length: skeletonRows }, (_, index) => (
                // Placeholder rows have no identity of their own.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
                <tr key={index}>
                  {columns.map((column, cell) => (
                    <td
                      key={column.id}
                      className={cn(column.className, column.align === "end" && "data-table-end")}
                    >
                      <span
                        className="data-table-bone"
                        style={{
                          width: `${skeletonWidths[(index + cell) % skeletonWidths.length]}%`,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <tbody>
              {state === "rows" &&
                rows?.map((row) => {
                  const { className: rowClass, ...data } = rowAttributes?.(row) ?? {};
                  return (
                    <tr key={rowKey(row)} className={rowClass} {...data}>
                      {columns.map((column) => {
                        const text = label(column);
                        const content = (
                          <>
                            {text && (
                              <span className="data-table-label" aria-hidden="true">
                                {text}
                              </span>
                            )}
                            {column.cell(row)}
                          </>
                        );
                        const cellClass = cn(
                          column.className,
                          column.align === "end" && "data-table-end",
                        );
                        return column.rowHeader ? (
                          <th key={column.id} scope="row" className={cellClass}>
                            {content}
                          </th>
                        ) : (
                          <td key={column.id} className={cellClass}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              {state === "error" && (
                <tr className="data-table-state">
                  <td colSpan={span}>
                    <div role="alert" className="data-table-message">
                      <div className="data-table-error">{error ?? t("dataTable.loadError")}</div>
                      {onRetry && (
                        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
                          {t("dataTable.retry")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {state === "empty-filtered" && filtered && (
                <tr className="data-table-state">
                  <td colSpan={span}>
                    <div className="data-table-message">
                      <div>{filtered.message ?? t("dataTable.nothingFound")}</div>
                      <Button type="button" variant="outline" size="xs" onClick={filtered.onReset}>
                        {t("dataTable.resetFilters")}
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
              {state === "empty" && (
                <tr className="data-table-state">
                  <td colSpan={span}>
                    <div className="data-table-message">
                      <div>{empty?.message ?? t("dataTable.nothingFound")}</div>
                      {empty?.action}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </Table>
      </div>
      {(footer || showPager) && (
        <div className="data-table-footer">
          {footer}
          {showPager && pagination && (
            <Pager
              pages={pagination.pages}
              nextCursor={pagination.nextCursor}
              busy={busy}
              range={{
                pageSize: pagination.pageSize,
                count: rows?.length ?? 0,
                total: pagination.total,
              }}
              {...(pagination.label ? { label: pagination.label } : {})}
            />
          )}
        </div>
      )}
    </div>
  );
}
