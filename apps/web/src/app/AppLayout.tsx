import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import fontLicenseUrl from "../../../../third_party/huninn/OFL.txt?url";
import { SignOutStatus, useSignOut } from "../features/account/sign-out.js";
import { BottomNavigation } from "./BottomNavigation.js";
import { type MobileNavigate, Navigation } from "./Navigation.js";
import { Breadcrumb, MemberSidebar } from "./MemberNavigation.js";
import { landingPath, sidebarStorageKey } from "./navigation-model.js";
import { writeStoredLocale } from "../shared/i18n.js";
import { useSession } from "./Session.js";
import { UserMenu } from "./UserMenu.js";
import { NearestEvent } from "../features/events/components.js";
import { UpcomingEventChip } from "../features/events/UpcomingEventChip.js";
import "../features/events/events.css";
import { publicContent } from "../features/landing/content.js";
import { LandingFooter } from "../features/landing/LandingFooter.js";
import { LandingHeader } from "../features/landing/LandingHeader.js";
import { LandingMenu } from "../features/landing/LandingMenu.js";
import { OptionalNotifications } from "../features/notifications/controller.js";
import { NotificationBell, NotificationToasts } from "../features/notifications/components.js";
import "../features/notifications/notifications.css";
import { useWorkspaceSummary } from "./workspace-summary.js";

function storedCollapse() {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return false;
  }
}

/**
 * Shared landmarks: public horizontal navigation, the synthetic member preview, or the live
 * workspace with role-grouped sidebar, breadcrumb topbar and user menu (bottom bar on phones).
 * The public landing (`landing`) swaps in its own self-contained dark header and footer.
 */
export function AppLayout({
  member,
  landing = false,
  children,
  onMobileNavigate,
}: {
  member: boolean;
  landing?: boolean;
  children: ReactNode;
  onMobileNavigate: MobileNavigate;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("core");
  const session = useSession();
  const signOut = useSignOut();
  const { data: attention } = useWorkspaceSummary({ refreshOnFocus: true });
  const [collapsed, setCollapsed] = useState(storedCollapse);
  const home = i18n.resolvedLanguage === "en" ? "/en" : "/";
  const preview = location.pathname.startsWith("/foundation");
  const live = member && !preview;
  const signingOut = live && signOut.active;
  const userMenu = live && session.state === "authenticated" && !signingOut;
  // Phones replace the topbar user menu and navigation dialog with the bottom bar (CSS < 768px).
  const bar = userMenu;
  useEffect(() => {
    // Workspace pages extend under display cutouts; safe-area insets keep content and the bar clear.
    if (!live) return;
    const viewport = document.querySelector('meta[name="viewport"]');
    const original = viewport?.getAttribute("content");
    if (!viewport || original == null || original.includes("viewport-fit")) return;
    viewport.setAttribute("content", `${original}, viewport-fit=cover`);
    return () => viewport.setAttribute("content", original);
  }, [live]);
  // Live workspace pages switch language through the user menu whenever it is shown; otherwise
  // (anonymous, unavailable or signing out) the select stays, except while the session is checked.
  const languageSelect = !live || (!userMenu && session.state !== "checking");
  const languagePicker = languageSelect && (
    <label className="language-picker">
      <span>{t("language")}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(event) => {
          const locale = event.target.value as "ru" | "en";
          if (
            location.pathname.startsWith("/account") ||
            location.pathname.replace(/\/$/, "") === "/login"
          ) {
            writeStoredLocale(locale);
          }
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
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const account = session.self
    ? { to: landingPath, label: t("nav.workspaceLink") }
    : { to: "/login", label: publicContent[locale].login };
  return (
    <div
      className={
        landing
          ? "landing-shell"
          : live
            ? `app-shell member-shell event-member-shell workspace-shell${collapsed ? " sidebar-collapsed" : ""}${bar ? " has-bottom-bar" : ""}`
            : member
              ? "app-shell member-shell"
              : "app-shell public-shell"
      }
    >
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      {landing ? null : live ? (
        <MemberSidebar
          collapsed={collapsed}
          attention={attention}
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
      {landing ? (
        <LandingHeader
          locale={locale}
          interactive
          account={
            <Link className="landing-header-signin" to={account.to}>
              {account.label}
            </Link>
          }
          language={languagePicker}
          bell={bell}
          menu={
            <LandingMenu
              locale={locale}
              account={account}
              language={languagePicker}
              onMobileNavigate={onMobileNavigate}
            />
          }
        />
      ) : (
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
              {live ? (
                <>
                  <span className="wordmark-full">Yukon Union</span>
                  <span className="wordmark-short" aria-hidden="true">
                    YU
                  </span>
                </>
              ) : (
                "Yukon Union"
              )}
            </Link>
            {live ? (
              <>
                <Breadcrumb />
                <div className="topbar-actions">
                  {session.state === "authenticated" &&
                    (session.eventsStage2Enabled ? (
                      <UpcomingEventChip />
                    ) : (
                      <NearestEvent variant="chip" />
                    ))}
                  {bell}
                  {userMenu && <UserMenu placement="topbar" />}
                  <Navigation
                    variant="mobile"
                    attention={attention}
                    onMobileNavigate={onMobileNavigate}
                  />
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
      )}
      {bar && <BottomNavigation attention={attention} onMobileNavigate={onMobileNavigate} />}
      <main id="main-content" tabIndex={-1}>
        {signingOut ? <SignOutStatus /> : children}
      </main>
      {landing ? (
        <LandingFooter locale={locale} interactive />
      ) : (
        <footer className="site-footer">
          <span>
            {preview || location.pathname === "/status" ? t("footer") : "Yukon Union · ETS2 / ATS"}
          </span>
          <a href={fontLicenseUrl}>{t("fontLicense")}</a>
        </footer>
      )}
      <OptionalNotifications>
        <NotificationToasts />
      </OptionalNotifications>
    </div>
  );
}
