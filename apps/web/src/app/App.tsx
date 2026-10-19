import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
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
import { Button, Card } from "../shared/ui/primitives.js";
import { LandingPage, PublicBoundaryPage } from "../features/landing/LandingPage.js";
import { publicContent } from "../features/landing/content.js";
import { AppLayout } from "./AppLayout.js";
import { ReadinessPage } from "./ReadinessPage.js";
import { RouteErrorBoundary } from "./RouteErrorBoundary.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const memberPath = "/foundation/member";
const FoundationPage = lazy(() =>
  import("../features/foundation/FoundationPage.js").then((module) => ({
    default: module.FoundationPage,
  })),
);

function Shell() {
  const { t, i18n } = useTranslation("core");
  const location = useLocation();
  const memberMatch = useMatch(memberPath);
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
    document.title = publicPage ? publicContent[locale].title : "Yukon Union";
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
  }, [i18n, i18n.resolvedLanguage, location.pathname, location.search]);
  if (memberMatch && location.pathname !== memberPath)
    return (
      <Navigate
        replace
        to={{ pathname: memberPath, search: location.search, hash: location.hash }}
      />
    );
  return (
    <AppLayout member={memberMatch !== null}>
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
            <Route path="/events" element={<PublicBoundaryPage kind="events" />} />
            <Route path="/login" element={<PublicBoundaryPage kind="login" />} />
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
