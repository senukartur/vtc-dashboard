import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import fontLicenseUrl from "../../../../third_party/onest/OFL.txt?url";
import { type MobileNavigate, Navigation } from "./Navigation.js";
import { NearestEvent } from "../features/events/components.js";
import "../features/events/events.css";

/** Shared landmarks with public navigation or a presentation-only member sidebar/topbar. */
export function AppLayout({
  member,
  children,
  onMobileNavigate,
}: {
  member: boolean;
  children: ReactNode;
  onMobileNavigate: MobileNavigate;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("core");
  const home = i18n.resolvedLanguage === "en" ? "/en" : "/";
  const preview = location.pathname.startsWith("/foundation");
  return (
    <div
      className={
        member
          ? `app-shell member-shell${preview ? "" : " event-member-shell"}`
          : "app-shell public-shell"
      }
    >
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
      <div className="event-shell-header">
        <header className="site-header">
          <Link
            className="wordmark header-wordmark"
            to={
              member ||
              location.pathname.startsWith("/foundation") ||
              location.pathname === "/status"
                ? "/"
                : home
            }
          >
            Yukon Union
          </Link>
          <p className="member-context">{preview ? t("member") : t("account:account")}</p>
          <Navigation variant={member ? "mobile" : "public"} onMobileNavigate={onMobileNavigate} />
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
        {member && !preview && <NearestEvent />}
      </div>
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
