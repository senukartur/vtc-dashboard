import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Readiness } from "@vtc/contracts";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function fetchReadiness(): Promise<Readiness> {
  const response = await fetch("/health/ready", { cache: "no-store" });
  if (response.status !== 200 && response.status !== 503) throw new Error("READINESS_UNAVAILABLE");
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("status" in data) ||
    (data.status !== "ready" && data.status !== "not_ready")
  )
    throw new Error("INVALID_READINESS");
  return { status: data.status };
}

function Workspace() {
  const { t } = useTranslation();
  const readiness = useQuery({ queryKey: ["readiness"], queryFn: fetchReadiness });
  const message = readiness.isPending
    ? "checking"
    : readiness.isError
      ? "failed"
      : readiness.data.status === "ready"
        ? "ready"
        : "unavailable";
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{t("stage")}</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{t("heading")}</h1>
      <p className="mt-4 max-w-prose text-lg leading-relaxed text-slate-600">{t("description")}</p>
      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
        <p>{t(message)}</p>
        <button
          type="button"
          className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          disabled={readiness.isFetching}
          onClick={() => void readiness.refetch()}
        >
          {t("retry")}
        </button>
      </div>
    </>
  );
}

function Shell() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-8 sm:py-16">
      <div className="mb-6 flex justify-end">
        <label className="flex items-center gap-3">
          {t("language")}
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            value={i18n.resolvedLanguage}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <Routes>
          <Route path="/" element={<Workspace />} />
          <Route
            path="*"
            element={
              <>
                <h1>{t("notFound")}</h1>
                <Link to="/">{t("home")}</Link>
              </>
            }
          />
        </Routes>
      </section>
    </main>
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
