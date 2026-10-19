import type { components } from "@vtc/contracts";
import { lazy, Suspense, useState } from "react";
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
import { Badge, Button, Card, Label, Table } from "../../shared/ui/primitives.js";
import { LocalForm } from "./LocalForm.js";
import { createFoundationMocks, type FoundationMocks, fixtureId } from "./mocks.js";

const states = ["success", "loading", "empty", "error", "forbidden", "partial"] as const;
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

function TripList({ response, locale }: { response: FoundationMocks["trips"]; locale: Locale }) {
  const { t } = useTranslation("foundation");
  return (
    <div className="trip-list">
      <Table>
        <caption>{t("tripsCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("driver")}</th>
            <th scope="col">{t("route")}</th>
            <th scope="col">{t("distance")}</th>
            <th scope="col">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {response.data.items.map((trip) => (
            <tr key={trip.id}>
              <td data-label={t("driver")}>
                <strong>{trip.owner.nickname}</strong>
                <small>{trip.game.toUpperCase()}</small>
              </td>
              <td data-label={t("route")}>
                <div className="route">
                  <CatalogName label={trip.origin} />
                  <span className="route-arrow" aria-hidden="true">
                    ↓
                  </span>
                  <CatalogName label={trip.destination} />
                </div>
              </td>
              <td data-label={t("distance")} className="numeric">
                {formatQuantity(trip.actualDistanceM, "km", locale)}
              </td>
              <td data-label={t("status")}>
                <Badge
                  className={trip.decision === "accepted" ? "badge-accepted" : "badge-neutral"}
                >
                  <span aria-hidden="true">{trip.decision === "accepted" ? "✓" : "—"}</span>
                  {t(trip.decision === "accepted" ? "accepted" : "unassessed")}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
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
  const [selected, setSelected] = useState(fixtureId);
  const [displayTimezone, setDisplayTimezone] = useState("UTC");
  const mocks = mockFactory(locale);
  const visibleTrips =
    state === "empty" ? mocks.empty : state === "partial" ? mocks.partial : mocks.trips;
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
            <div className="content-state" aria-live="polite" aria-busy={state === "loading"}>
              {state === "loading" ? (
                <div className="state-message">
                  <span className="status-symbol" aria-hidden="true">
                    …
                  </span>
                  <p>{t("loadingText")}</p>
                  <Button variant="outline" onClick={() => setState("success")}>
                    {t("reset")}
                  </Button>
                </div>
              ) : state === "error" ? (
                <div className="state-message" role="alert">
                  <span className="status-symbol" aria-hidden="true">
                    !
                  </span>
                  <h3>{t("errorTitle")}</h3>
                  <p>{t("errorText")}</p>
                  <Button variant="outline" onClick={() => setState("success")}>
                    {t("retry")}
                  </Button>
                </div>
              ) : state === "forbidden" ? (
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
              ) : visibleTrips.data.items.length === 0 ? (
                <div className="state-message">
                  <span className="status-symbol" aria-hidden="true">
                    —
                  </span>
                  <h3>{t("emptyTitle")}</h3>
                  <p>{t("emptyText")}</p>
                  <Button variant="outline" onClick={() => setState("success")}>
                    {t("reset")}
                  </Button>
                </div>
              ) : (
                <>
                  {state === "partial" && <p className="notice">{t("partialText")}</p>}
                  <TripList response={visibleTrips} locale={locale} />
                </>
              )}
            </div>
          </Card>
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
