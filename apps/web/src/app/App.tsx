import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactElement, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
} from "react-router-dom";
import { AccountPage } from "../features/account/AccountPage.js";
import { AuthPage } from "../features/account/AuthPage.js";
import type { LinkHandoff } from "../features/account/link.js";
import { SignOutProvider } from "../features/account/sign-out.js";
import { CatalogsPage } from "../features/catalogs/CatalogsPage.js";
import { publicContent } from "../features/landing/content.js";
import { LandingPage } from "../features/landing/LandingPage.js";
import { Button, Card } from "../shared/ui/primitives.js";
import { AppLayout } from "./AppLayout.js";
import { matchRouteMeta, paths, type RouteId } from "./navigation-model.js";
import { ReadinessPage } from "./ReadinessPage.js";
import { RouteErrorBoundary } from "./RouteErrorBoundary.js";
import { ProtectedAccount, SessionProvider } from "./Session.js";
import { createAppQueryClient } from "./session-cache.js";
import { NotificationsProvider } from "../features/notifications/controller.js";
const NotificationsPage = lazy(() =>
  import("../features/notifications/page.js").then((module) => ({
    default: module.NotificationsPage,
  })),
);

const TripsPage = lazy(() =>
  import("../features/trips/TripsPage.js").then((module) => ({ default: module.TripsPage })),
);
const QualificationsPage = lazy(() =>
  import("../features/qualifications/QualificationsPage.js").then((module) => ({
    default: module.QualificationsPage,
  })),
);
const TripDetailPage = lazy(() =>
  import("../features/trips/TripDetailPage.js").then((module) => ({
    default: module.TripDetailPage,
  })),
);
const ReportsPage = lazy(() =>
  import("../features/manual-reports/ManualReportPage.js").then((module) => ({
    default: module.ReportsPage,
  })),
);
const ManualReportPage = lazy(() =>
  import("../features/manual-reports/ManualReportPage.js").then((module) => ({
    default: module.ManualReportPage,
  })),
);
const ReconciliationPage = lazy(() =>
  import("../features/review/ReconciliationPage.js").then((module) => ({
    default: module.ReconciliationPage,
  })),
);
const DashboardPage = lazy(() =>
  import("../features/dashboard/DashboardPage.js").then((module) => ({
    default: module.DashboardPage,
  })),
);
const DriversPage = lazy(() =>
  import("../features/drivers/DriversPage.js").then((module) => ({
    default: module.DriversPage,
  })),
);
const DriverProfilePage = lazy(() =>
  import("../features/drivers/DriverProfilePage.js").then((module) => ({
    default: module.DriverProfilePage,
  })),
);

const ApplicationsPage = lazy(() =>
  import("../features/admin/ApplicationsPage.js").then((module) => ({
    default: module.ApplicationsPage,
  })),
);
const MembersPage = lazy(() =>
  import("../features/admin/MembersPage.js").then((module) => ({ default: module.MembersPage })),
);
const SettingsPage = lazy(() =>
  import("../features/admin/SettingsPage.js").then((module) => ({ default: module.SettingsPage })),
);
const ConnectionsPage = lazy(() =>
  import("../features/connections/ConnectionsPage.js").then((module) => ({
    default: module.ConnectionsPage,
  })),
);

const queryClient = createAppQueryClient();
const EventsPage = lazy(() =>
  import("../features/events/EventsPage.js").then((m) => ({ default: m.EventsPage })),
);
const CreateEventPage = lazy(() =>
  import("../features/events/EventsPage.js").then((m) => ({ default: m.CreateEventPage })),
);
const EventDetailPage = lazy(() =>
  import("../features/events/EventDetailPage.js").then((m) => ({ default: m.EventDetailPage })),
);
const memberPath = "/foundation/member";
// Keyed by the navigation model so every workspace pattern has exactly one element.
const accountRoutes: Record<RouteId, ReactElement> = {
  account: <AccountPage />,
  connections: <ConnectionsPage />,
  notifications: <NotificationsPage />,
  dashboard: <DashboardPage />,
  trips: <TripsPage />,
  trip: <TripDetailPage />,
  reports: <ReportsPage />,
  newReport: <ManualReportPage kind="new" />,
  draft: <ManualReportPage kind="draft" />,
  revise: <ManualReportPage kind="report" />,
  events: <EventsPage />,
  newEvent: <CreateEventPage />,
  event: <EventDetailPage />,
  drivers: <DriversPage />,
  driver: <DriverProfilePage />,
  qualifications: <QualificationsPage />,
  review: <TripsPage review />,
  reconciliation: <ReconciliationPage />,
  reviewTrip: <TripDetailPage review />,
  applications: <ApplicationsPage />,
  members: <MembersPage />,
  catalogs: <CatalogsPage />,
  settings: <SettingsPage />,
};
const FoundationPage = lazy(() =>
  import("../features/foundation/FoundationPage.js").then((module) => ({
    default: module.FoundationPage,
  })),
);

function Shell({ handoff }: { handoff: LinkHandoff }) {
  const { t, i18n } = useTranslation("core");
  const location = useLocation();
  const memberMatch = useMatch(memberPath);
  const accountMatch = useMatch("/account/*");
  const previousPath = useRef(location.pathname);
  const mobileFocus = useRef<{
    origin: typeof location;
    destination: string;
    trigger: HTMLButtonElement | null;
  } | null>(null);
  useEffect(() => {
    const { pathname, search, hash } = location;
    const intent = mobileFocus.current;
    // A menu action can precede its origin commit's passive effect.
    const isOrigin = intent?.origin === location;
    const mobileClose = !isOrigin && intent?.destination === `${pathname}${search}${hash}`;
    const trigger = mobileClose ? intent.trigger : null;
    if (trigger?.isConnected && trigger.getClientRects().length > 0)
      trigger.focus({ preventScroll: true });
    else if (!hash && !isOrigin && (previousPath.current !== pathname || mobileClose))
      document.getElementById("main-content")?.focus();
    previousPath.current = pathname;
    // Consume even same-path/hash destinations after the origin effect has passed.
    if (!isOrigin) mobileFocus.current = null;
  }, [location]);
  useEffect(() => {
    if (["#about", "#apply", "#contacts"].includes(location.hash))
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash]);
  useEffect(() => {
    const locale =
      location.pathname === "/en"
        ? "en"
        : location.pathname === "/"
          ? "ru"
          : i18n.resolvedLanguage === "en"
            ? "en"
            : "ru";
    if (i18n.resolvedLanguage !== locale) void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    const publicPage = ["/", "/en"].includes(location.pathname) && !location.search;
    const workspace = matchRouteMeta(location.pathname);
    document.title = publicPage
      ? publicContent[locale].title
      : workspace
        ? `${t(workspace.titleKey)} · Yukon Union`
        : "Yukon Union";
    document
      .querySelector('meta[name="robots"]')
      ?.setAttribute("content", publicPage ? "index, follow" : "noindex, nofollow");
    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.setAttribute("name", "description");
      document.head.append(description);
    }
    description.setAttribute(
      "content",
      publicPage ? publicContent[locale].description : "Yukon Union",
    );
  }, [i18n, i18n.resolvedLanguage, location.pathname, location.search, t]);
  if (memberMatch && location.pathname !== memberPath)
    return (
      <Navigate
        replace
        to={{ pathname: memberPath, search: location.search, hash: location.hash }}
      />
    );
  return (
    <AppLayout
      member={memberMatch !== null || accountMatch !== null}
      onMobileNavigate={(href, trigger) => {
        const destination = new URL(href, window.location.href);
        mobileFocus.current = {
          origin: location,
          destination: `${destination.pathname}${destination.search}${destination.hash}`,
          trigger,
        };
      }}
    >
      <RouteErrorBoundary
        key={["/", "/en"].includes(location.pathname) ? "public-landing" : location.pathname}
        fallbackTitle={t("renderError")}
        recoverLabel={t("recover")}
      >
        <Suspense
          fallback={
            <Card role="status" aria-busy="true">
              {t("loadingView")}
            </Card>
          }
        >
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/en" element={<LandingPage />} />
            <Route path="/status" element={<ReadinessPage />} />
            <Route path="/events" element={<EventsPage publicView />} />
            <Route path="/events/:eventId" element={<EventDetailPage publicView />} />
            <Route path="/login" element={<AuthPage key="login" kind="login" />} />
            <Route
              path="/password-recovery"
              element={<AuthPage key="recovery" kind="recovery" />}
            />
            <Route
              path="/password-reset"
              element={
                <AuthPage
                  key="reset"
                  kind="reset"
                  handoff={handoff.path === "/password-reset" ? handoff : undefined}
                />
              }
            />
            <Route
              path="/invitation"
              element={
                <AuthPage
                  key="invitation"
                  kind="invitation"
                  handoff={handoff.path === "/invitation" ? handoff : undefined}
                />
              }
            />
            {(Object.keys(paths) as RouteId[]).map((id) => (
              <Route
                key={id}
                path={paths[id]}
                element={<ProtectedAccount>{accountRoutes[id]}</ProtectedAccount>}
              />
            ))}
            <Route path="/foundation" element={<FoundationPage key="public" />} />
            <Route path={memberPath} element={<FoundationPage key="member" member />} />
            <Route
              path="*"
              element={
                <Card>
                  <h1>{t("notFound")}</h1>
                  <Button asChild variant="outline">
                    <Link to="/">{t("home")}</Link>
                  </Button>
                </Card>
              }
            />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </AppLayout>
  );
}

export function App({ handoff }: { handoff: LinkHandoff }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <SignOutProvider>
            <NotificationsProvider>
              <Shell handoff={handoff} />
            </NotificationsProvider>
          </SignOutProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
