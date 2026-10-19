import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import fontLicenseUrl from "../../../../third_party/onest/OFL.txt?url";
import { Navigation } from "./Navigation.js";

/** Shared landmarks with public navigation or a presentation-only member sidebar/topbar. */
export function AppLayout({ member, children }: { member: boolean; children: ReactNode }) {
  const { t, i18n } = useTranslation("core");
  return (
    <div className={member ? "app-shell member-shell" : "app-shell public-shell"}>
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      <aside className="member-sidebar" hidden={!member} aria-label={t("workspaceNavigation")}>
        <Link className="wordmark" to="/">
          Yukon Union
        </Link>
        <p className="sidebar-label">{t("workspaceNavigation")}</p>
        <Navigation variant="sidebar" />
        <p className="sidebar-note">{t("presentationOnly")}</p>
      </aside>
      <header className="site-header">
        <Link className="wordmark header-wordmark" to="/">
          Yukon Union
        </Link>
        <p className="member-context">{t("member")}</p>
        <Navigation variant={member ? "mobile" : "public"} />
        <label className="language-picker">
          {t("language")}
          <select
            value={i18n.resolvedLanguage}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
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
        <span>{t("footer")}</span>
        <a href={fontLicenseUrl}>{t("fontLicense")}</a>
      </footer>
    </div>
  );
}
