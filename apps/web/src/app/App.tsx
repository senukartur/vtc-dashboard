import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Button, Card } from "../shared/ui/primitives.js";
import { AppLayout } from "./AppLayout.js";
import { ReadinessPage } from "./ReadinessPage.js";
import { RouteErrorBoundary } from "./RouteErrorBoundary.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const FoundationPage = lazy(() =>
  import("../features/foundation/FoundationPage.js").then((module) => ({
    default: module.FoundationPage,
  })),
);

function Shell() {
  const { t, i18n } = useTranslation("core");
  const location = useLocation();
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);
  return (
    <AppLayout member={location.pathname === "/foundation/member"}>
      <RouteErrorBoundary
        key={location.pathname}
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
            <Route path="/" element={<ReadinessPage />} />
            <Route path="/foundation" element={<FoundationPage key="public" />} />
            <Route path="/foundation/member" element={<FoundationPage key="member" member />} />
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
