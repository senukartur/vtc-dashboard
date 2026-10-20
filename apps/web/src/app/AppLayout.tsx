import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import fontLicenseUrl from "../../../../third_party/onest/OFL.txt?url";
import { Navigation } from "./Navigation.js";

/** Shared landmarks with public navigation or a presentation-only member sidebar/topbar. */
export function AppLayout({
  member,
  children,
  onMenuNavigate,
}: {
  member: boolean;
  children: ReactNode;
  onMenuNavigate: (pathname: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("core");
  const home = i18n.resolvedLanguage === "en" ? "/en" : "/";
  const preview = location.pathname.startsWith("/foundation");
  return (
    <div className={member ? "app-shell member-shell" : "app-shell public-shell"}>
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      <aside className="member-sidebar" hidden={!member} aria-label={t("workspaceNavigation")}>
        <Link className="wordmark" to="/">
          Yukon Union
        </Link>
        <p className="sidebar-label">{preview ? t("workspaceNavigation") : t("account:account")}</p>
        <Navigation variant="sidebar" />
        {preview && <p className="sidebar-note">{t("presentationOnly")}</p>}
      </aside>
      <header className="site-header">
        <Link
          className="wordmark header-wordmark"
          to={
            member || location.pathname.startsWith("/foundation") || location.pathname === "/status"
              ? "/"
              : home
          }
        >
          Yukon Union
        </Link>
        <p className="member-context">{preview ? t("member") : t("account:account")}</p>
        <Navigation variant={member ? "mobile" : "public"} onMenuNavigate={onMenuNavigate} />
        <label className="language-picker">
          {t("language")}
          <select
            value={i18n.resolvedLanguage}
            onChange={(event) => {
              const locale = event.target.value;
              void i18n.changeLanguage(locale);
              if (["/", "/en"].includes(location.pathname))
                navigate(
                  {
                    pathname: locale === "en" ? "/en" : "/",
                    search: location.search,
                    hash: location.hash,
                  },
                  { replace: true },
                );
            }}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <span>
          {location.pathname.startsWith("/foundation") || location.pathname === "/status"
            ? t("footer")
            : "Yukon Union · ETS2 / ATS"}
        </span>
        <a href={fontLicenseUrl}>{t("fontLicense")}</a>
      </footer>
    </div>
  );
}
