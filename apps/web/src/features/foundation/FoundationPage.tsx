import type { components } from "@vtc/contracts";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatQuantity, type Locale } from "../../shared/formatting.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import { Badge, Button, Card, Label } from "../../shared/ui/primitives.js";
import { ControlsExample } from "./ControlsExample.js";
import { LocalForm } from "./LocalForm.js";
import { createFoundationMocks, type FoundationMocks, fixtureId } from "./mocks.js";
import { ServerTableExample } from "./ServerTableExample.js";

const states = [
  "success",
  "loading",
  "empty",
  "filtered",
  "error",
  "forbidden",
  "partial",
] as const;
type ContentState = (typeof states)[number];
const AnalyticsExample = lazy(() =>
  import("./AnalyticsExample.js").then((module) => ({ default: module.AnalyticsExample })),
);

function CatalogName({ label }: { label: components["schemas"]["CatalogLabel"] | null }) {
  const { t } = useTranslation("foundation");
  if (!label) return <span className="muted">{t("unavailable")}</span>;
  return (
    <span>
      <span lang={label.renderedLocale}>{label.label}</span>
      {label.englishFallback && <small className="fallback">{t("fallback")}</small>}
    </span>
  );
}

type Trip = FoundationMocks["trips"]["data"]["items"][number];

/**
 * The example list as a static DataTable; the content-state selector drives its loading, error,
 * empty and empty-after-filters states. Retry and Reset return to the available example.
 */
function TripList({
  rows,
  state,
  locale,
  onRecover,
  onReset,
}: {
  rows: Trip[];
  state: ContentState;
  locale: Locale;
  onRecover: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("foundation");
  const columns: DataTableColumn<Trip>[] = [
    {
      id: "driver",
      header: t("driver"),
      cell: (trip) => (
        <>
          <strong>{trip.owner.nickname}</strong>
          <small>{trip.game.toUpperCase()}</small>
        </>
      ),
    },
    {
      id: "route",
      header: t("route"),
      cell: (trip) => (
        <div className="route">
          <CatalogName label={trip.origin} />
          <span className="route-arrow" aria-hidden="true">
            ↓
          </span>
          <CatalogName label={trip.destination} />
        </div>
      ),
    },
    {
      id: "distance",
      header: t("distance"),
      align: "end",
      cell: (trip) => formatQuantity(trip.actualDistanceM, "km", locale),
    },
    {
      id: "status",
      header: t("status"),
      cell: (trip) => (
        <Badge className={trip.decision === "accepted" ? "badge-accepted" : "badge-neutral"}>
          <span aria-hidden="true">{trip.decision === "accepted" ? "✓" : "—"}</span>
          {t(trip.decision === "accepted" ? "accepted" : "unassessed")}
        </Badge>
      ),
    },
  ];
  return (
    <DataTable
      className="trip-list-example"
      caption={t("tripsCaption")}
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(trip) => trip.id}
      status={state === "loading" ? "loading" : state === "error" ? "error" : "ready"}
      skeletonRows={3}
      error={
        <>
          <strong>{t("errorTitle")}</strong> {t("errorText")}
        </>
      }
      onRetry={onRecover}
      empty={{
        message: (
          <>
            <h3>{t("emptyTitle")}</h3>
            <p>{t("emptyText")}</p>
          </>
        ),
        action: (
          <Button variant="outline" size="xs" onClick={onRecover}>
            {t("reset")}
          </Button>
        ),
      }}
      {...(state === "filtered" ? { filtered: { onReset } } : {})}
    />
  );
}

export function FoundationPage({
  member = false,
  mockFactory = createFoundationMocks,
}: {
  member?: boolean;
  mockFactory?: (locale: Locale) => FoundationMocks;
}) {
  const { t, i18n } = useTranslation("foundation");
  const { t: core } = useTranslation("core");
  const locale: Locale = i18n.resolvedLanguage === "ru" ? "ru" : "en";
  const [state, setState] = useState<ContentState>("success");
  const stateSelect = useRef<HTMLSelectElement>(null);
  const [selected, setSelected] = useState(fixtureId);
  const [displayTimezone, setDisplayTimezone] = useState("UTC");
  const mocks = mockFactory(locale);
  const visibleTrips =
    state === "empty" || state === "filtered"
      ? mocks.empty
      : state === "partial"
        ? mocks.partial
        : mocks.trips;
  const permitted = state !== "forbidden";
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t(member ? "memberTitle" : "title")}</h1>
        <p className="lead">{t(member ? "memberIntro" : "intro")}</p>
        <div className="heading-actions">
          <Badge className="badge-preview">{t("synthetic")}</Badge>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{t("dialog")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>{t("dialog")}</DialogTitle>
              <DialogDescription>{t("dialogDescription")}</DialogDescription>
              <p lang="en" className="muted">
                {t("fallbackProbe")}
              </p>
              <DialogClose asChild>
                <Link className="button button-ghost" to="/status">
                  {core("readiness")}
                </Link>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="outline">{core("close")}</Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <div className={member ? "foundation-grid member-grid" : "foundation-grid"}>
        <div className="stack main-column">
          <Card aria-labelledby="trips-title">
            <div className="section-heading">
              <div>
                <h2 id="trips-title">{t("panel")}</h2>
                <p className="muted">{t("panelHelp")}</p>
              </div>
              <div className="field">
                <Label htmlFor="content-state">{t("state")}</Label>
                <select
                  ref={stateSelect}
                  id="content-state"
                  value={state}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (states.some((candidate) => candidate === next))
                      setState(next as ContentState);
                  }}
                >
                  {states.map((item) => (
                    <option key={item} value={item}>
                      {t(item)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="content-state" aria-live="polite">
              {state === "forbidden" ? (
                <div className="state-message">
                  <span className="status-symbol" aria-hidden="true">
                    ×
                  </span>
                  <h3>{t("forbiddenTitle")}</h3>
                  <p>{t("forbiddenText")}</p>
                  <Button asChild variant="outline">
                    <Link to="/foundation" onClick={() => setState("success")}>
                      {core("public")}
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  {state === "partial" && <p className="notice">{t("partialText")}</p>}
                  <TripList
                    rows={visibleTrips.data.items}
                    state={state}
                    locale={locale}
                    onRecover={() => setState("success")}
                    onReset={() => {
                      // The reset button unmounts with the empty state; focus the selector.
                      stateSelect.current?.focus();
                      setState("success");
                    }}
                  />
                </>
              )}
            </div>
          </Card>
          {permitted && <ServerTableExample locale={locale} displayTimezone={displayTimezone} />}
          {permitted && (
            <Card aria-labelledby="catalog-title">
              <h2 id="catalog-title">{t("selection")}</h2>
              <p className="muted">{t("selectorHelp")}</p>
              <Label htmlFor="catalog-city">{t("selection")}</Label>
              <select
                id="catalog-city"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value={mocks.catalog.data.id}>{mocks.catalog.data.display.label}</option>
              </select>
              <p lang={mocks.catalog.data.display.renderedLocale}>
                {mocks.catalog.data.display.label}
              </p>
              {mocks.catalog.data.display.englishFallback && (
                <span className="fallback">{t("fallback")}</span>
              )}
              <p className="muted">
                {t("selectedId")}: <code>{selected}</code>
              </p>
              <p>
                {t("mass")}: <strong>{formatQuantity("12500.5", "t", locale)}</strong>
              </p>
            </Card>
          )}
          <ControlsExample />
        </div>
        <aside className="stack supporting-column" aria-label={t("formTitle")}>
          <LocalForm />
          {permitted && (
            <Card className="preferences">
              <Label htmlFor="display-timezone">{t("displayZone")}</Label>
              <select
                id="display-timezone"
                value={displayTimezone}
                onChange={(event) => setDisplayTimezone(event.target.value)}
              >
                <option value="UTC">UTC</option>
                <option value="Europe/Warsaw">Europe/Warsaw</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
              </select>
              <p className="muted">{t("zoneHelp")}</p>
            </Card>
          )}
        </aside>
        {permitted && (
          <Suspense
            fallback={
              <Card className="analytics" aria-busy="true" role="status">
                <h2>{t("chart")}</h2>
                <p>{core("loadingView")}</p>
              </Card>
            }
          >
            <AnalyticsExample
              response={mocks.analytics}
              locale={locale}
              displayTimezone={displayTimezone}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
