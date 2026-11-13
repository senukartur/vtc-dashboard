// The one pager for cursor lists: DataTable footers and paged lists that are not tables.
import { useTranslation } from "react-i18next";
import { formatDecimal, type Locale } from "../formatting.js";
import type { CursorPages } from "../paging.js";
import { pageSummary } from "./data-table-model.js";
import { Button } from "./primitives.js";
import "./data-table.css";

export type PagerRange = { pageSize: number; count: number; total?: number | undefined };

/**
 * Previous/next buttons keep their names ("Previous page"/"Next page") and use aria-disabled
 * with a click guard instead of `disabled`, so focus stays on a button that becomes unavailable
 * at the ends or while the next page loads. Desktop shows icon buttons; below the card breakpoint
 * the buttons are full width with visible text that is part of the accessible name.
 */
export function Pager({
  pages,
  nextCursor,
  busy = false,
  range,
  label,
}: {
  pages: CursorPages;
  nextCursor: string | null | undefined;
  busy?: boolean;
  range?: PagerRange;
  label?: string;
}) {
  const { t, i18n } = useTranslation("core");
  const locale: Locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const canPrevious = pages.hasPrevious && !busy,
    canNext = !!nextCursor && !busy;
  const summary = range && !busy ? pageSummary({ page: pages.page, ...range }) : null;
  const number = (value: number) => formatDecimal(String(value), locale);
  return (
    <nav className="pager" aria-label={label ?? t("dataTable.pages")}>
      {range && (
        <span className="pager-summary" aria-live="polite" aria-atomic="true">
          {summary?.kind === "page"
            ? t("dataTable.page", { page: number(summary.page) })
            : summary?.kind === "range"
              ? summary.from === 0
                ? t("dataTable.rangeEmpty", { total: number(summary.total) })
                : t("dataTable.range", {
                    from: number(summary.from),
                    to: number(summary.to),
                    total: number(summary.total),
                  })
              : null}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        className="pager-button pager-previous"
        aria-label={t("dataTable.previous")}
        aria-disabled={canPrevious ? undefined : true}
        onClick={() => {
          if (canPrevious) pages.previous();
        }}
      >
        <span aria-hidden="true">‹</span>
        <span className="pager-text">{t("dataTable.previousShort")}</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="pager-button pager-next"
        aria-label={t("dataTable.next")}
        aria-disabled={canNext ? undefined : true}
        onClick={() => {
          if (canNext && nextCursor) pages.next(nextCursor);
        }}
      >
        <span className="pager-text">{t("dataTable.nextShort")}</span>
        <span aria-hidden="true">›</span>
      </Button>
    </nav>
  );
}
