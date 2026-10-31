import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import fontLicenseUrl from "../../../../third_party/m-plus-rounded-1c/OFL.txt?url";
import { SignOutStatus, useSignOut } from "../features/account/sign-out.js";
import { type MobileNavigate, Navigation } from "./Navigation.js";
import { Breadcrumb, MemberSidebar } from "./MemberNavigation.js";
import { sidebarStorageKey } from "./navigation-model.js";
import { useSession } from "./Session.js";
import { UserMenu } from "./UserMenu.js";
import { NearestEvent } from "../features/events/components.js";
import "../features/events/events.css";
import { OptionalNotifications } from "../features/notifications/controller.js";
import { NotificationBell, NotificationToasts } from "../features/notifications/components.js";
import "../features/notifications/notifications.css";

function storedCollapse() {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return false;
  }
}

/**
 * Shared landmarks: public horizontal navigation, the synthetic member preview, or the live
 * workspace with role-grouped sidebar, breadcrumb topbar and user menu.
 */
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
  const session = useSession();
  const signOut = useSignOut();
  const [collapsed, setCollapsed] = useState(storedCollapse);
  const home = i18n.resolvedLanguage === "en" ? "/en" : "/";
  const preview = location.pathname.startsWith("/foundation");
  const live = member && !preview;
  const signingOut = live && signOut.active;
  const userMenu = live && session.state === "authenticated" && !signingOut;
  // Live workspace pages switch language through the user menu whenever it is shown; otherwise
  // (anonymous, unavailable or signing out) the select stays, except while the session is checked.
  const languageSelect = !live || (!userMenu && session.state !== "checking");
  const languagePicker = languageSelect && (
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
  );
  const bell = !signingOut && (
    <OptionalNotifications>
      <NotificationBell />
    </OptionalNotifications>
  );
  return (
    <div
      className={
        live
          ? `app-shell member-shell event-member-shell workspace-shell${collapsed ? " sidebar-collapsed" : ""}`
          : member
            ? "app-shell member-shell"
            : "app-shell public-shell"
      }
    >
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      {live ? (
        <MemberSidebar
          collapsed={collapsed}
          onToggle={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              window.localStorage.setItem(sidebarStorageKey, String(next));
            } catch {
              // Storage can be unavailable; the rail still toggles for this page view.
            }
          }}
        />
      ) : (
        <aside className="member-sidebar" hidden={!member} aria-label={t("workspaceNavigation")}>
          <Link className="wordmark" to="/">
            Yukon Union
          </Link>
          <p className="sidebar-label">{t("workspaceNavigation")}</p>
          <Navigation variant="sidebar" />
          <p className="sidebar-note">{t("presentationOnly")}</p>
        </aside>
      )}
      <div className="event-shell-header">
        <header className="site-header">
          <Link
            className="wordmark header-wordmark"
            to={
              live
                ? "/account/dashboard"
                : member || preview || location.pathname === "/status"
                  ? "/"
                  : home
            }
          >
            Yukon Union
          </Link>
          {live ? (
            <>
              <Breadcrumb />
              <div className="topbar-actions">
                {session.state === "authenticated" && <NearestEvent variant="chip" />}
                {bell}
                {userMenu && <UserMenu placement="topbar" />}
                <Navigation variant="mobile" onMobileNavigate={onMobileNavigate} />
                {languagePicker}
              </div>
            </>
          ) : (
            <>
              <p className="member-context">{t("member")}</p>
              <Navigation
                variant={member ? "mobile" : "public"}
                onMobileNavigate={onMobileNavigate}
              />
              {bell}
              {languagePicker}
            </>
          )}
        </header>
      </div>
      <main id="main-content" tabIndex={-1}>
        {signingOut ? <SignOutStatus /> : children}
      </main>
      <footer className="site-footer">
        <span>
          {preview || location.pathname === "/status" ? t("footer") : "Yukon Union · ETS2 / ATS"}
        </span>
        <a href={fontLicenseUrl}>{t("fontLicense")}</a>
      </footer>
      <OptionalNotifications>
        <NotificationToasts />
      </OptionalNotifications>
    </div>
  );
}
