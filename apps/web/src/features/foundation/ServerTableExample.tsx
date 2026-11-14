import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatQuantity, formatUtc, type Locale } from "../../shared/formatting.js";
import { useCursorPages } from "../../shared/paging.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import type { SortState } from "../../shared/ui/data-table-model.js";
import { Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";

type SortKey = "completed" | "distance";
type Row = {
  id: string;
  number: number;
  driver: string;
  route: Record<Locale, string>;
  completedAt: string;
  distanceM: string;
};

const pageSize = 4;
// A short presentation delay so the dimmed rows and the progress line are visible.
const delayMs = 450;
const routes: Record<Locale, string>[] = [
  { en: "Fictional Harbor → Fictional Ridge", ru: "Вымышленная Гавань → Вымышленный Хребет" },
  { en: "Fictional Quarry → Fictional Mill", ru: "Вымышленный Карьер → Вымышленная Мельница" },
  { en: "Fictional Junction → Fictional Port", ru: "Вымышленный Узел → Вымышленный Порт" },
  { en: "Fictional Valley → Fictional Depot", ru: "Вымышленная Долина → Вымышленный Склад" },
];
/** Eleven fictional trips: three pages of four, so both ends and a partial page are reachable. */
const rows: Row[] = Array.from({ length: 11 }, (_, index) => ({
  id: `41000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
  number: 1046 - index,
  driver: `Fixture Hauler ${(index % 5) + 1}`,
  route: routes[index % routes.length] ?? { en: "", ru: "" },
  completedAt: new Date(Date.UTC(2026, 9, 17, 20, 15) - index * 15 * 3_600_000).toISOString(),
  distanceM: String(120_000 + ((index * 137) % 380) * 1000),
}));

function sorted({ key, direction }: SortState<SortKey>) {
  const sign = direction === "asc" ? 1 : -1;
  const value = (row: Row) => (key === "completed" ? row.completedAt : Number(row.distanceM));
  return [...rows].sort((a, b) =>
    value(a) < value(b) ? -sign : value(a) > value(b) ? sign : b.number - a.number,
  );
}

/**
 * Synthetic server-table example: header sort, cursor pages with a local cursor (the row
 * offset), the busy state and both footer kinds. Nothing is requested from the API.
 */
export function ServerTableExample({
  locale,
  displayTimezone,
}: {
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("foundation");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "completed", direction: "desc" });
  const [withTotal, setWithTotal] = useState<"range" | "page">("range");
  const pages = useCursorPages(`${sort.key}:${sort.direction}`);
  const requested = `${sort.key}:${sort.direction}:${pages.cursor ?? "0"}`;
  // The rows on screen lag the request by the delay, like a server answer.
  const [shown, setShown] = useState(requested);
  useEffect(() => {
    if (shown === requested) return;
    const timer = window.setTimeout(() => setShown(requested), delayMs);
    return () => window.clearTimeout(timer);
  }, [requested, shown]);
  const [shownKey = "completed", shownDirection = "desc", shownOffset = "0"] = shown.split(":");
  const offset = Number(shownOffset);
  const visible = sorted({
    key: shownKey as SortKey,
    direction: shownDirection === "asc" ? "asc" : "desc",
  }).slice(offset, offset + pageSize);
  const requestedOffset = Number(pages.cursor ?? 0);
  const nextCursor =
    requestedOffset + pageSize < rows.length ? String(requestedOffset + pageSize) : null;
  const columns: DataTableColumn<Row, SortKey>[] = [
    {
      id: "number",
      header: t("colNumber"),
      className: "example-col-number",
      cell: (row) => <span className="muted">#{row.number}</span>,
    },
    {
      id: "completed",
      header: t("colCompleted"),
      sort: {
        key: "completed",
        defaultDirection: "desc",
        options: { desc: t("sortNewest"), asc: t("sortOldest") },
      },
      cell: (row) => (
        <time dateTime={row.completedAt}>
          {formatUtc(row.completedAt, locale, displayTimezone)}
        </time>
      ),
    },
    { id: "driver", header: t("colDriver"), cell: (row) => row.driver },
    { id: "route", header: t("route"), cell: (row) => row.route[locale] },
    {
      id: "distance",
      header: t("colDistance"),
      align: "end",
      sort: {
        key: "distance",
        defaultDirection: "desc",
        options: { desc: t("sortLongest"), asc: t("sortShortest") },
      },
      cell: (row) => formatQuantity(row.distanceM, "km", locale),
    },
  ];
  return (
    <Card aria-labelledby="server-table-title" className="server-table-example">
      <div className="section-heading">
        <div>
          <h2 id="server-table-title">{t("tableTitle")}</h2>
          <p className="muted">{t("tableHelp")}</p>
        </div>
        <SegmentedControl
          aria-label={t("tableFooter")}
          size="sm"
          value={withTotal}
          onValueChange={setWithTotal}
          options={[
            { value: "range", label: t("footerRange") },
            { value: "page", label: t("footerPage") },
          ]}
        />
      </div>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        busy={shown !== requested}
        sort={{ value: sort, onChange: setSort }}
        pagination={{
          pages,
          nextCursor,
          pageSize,
          total: withTotal === "range" ? rows.length : undefined,
        }}
      />
    </Card>
  );
}
