import { type MouseEvent, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useSignOut } from "../features/account/sign-out.js";
import { publicPath } from "../features/landing/content.js";
import { Button } from "../shared/ui/primitives.js";
import { NavIcon } from "./nav-icons.js";
import { canReport, matchRouteMeta, navItem, paths, visibleGroups } from "./navigation-model.js";
import { useSession } from "./Session.js";
import { UserMenu } from "./UserMenu.js";

type Navigate = (event: MouseEvent<HTMLAnchorElement>) => void;

/** Role-grouped workspace links shared by the desktop sidebar and the tablet/phone dialog. */
export function MemberNavLinks({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: Navigate | undefined;
  collapsed?: boolean;
}) {
  const { t, i18n } = useTranslation("core");
  const session = useSession();
  const location = useLocation();
  const prefix = useId();
  const tip = (label: string) => (collapsed ? label : undefined);
  if (session.state === "anonymous" || session.state === "unavailable") {
    const from = { pathname: location.pathname, search: location.search, hash: location.hash };
    return (
      <nav className="sidebar-navigation" aria-label={t("nav.primary")}>
        <ul className="nav-list">
          {session.state === "anonymous" && (
            <li>
              <Link to="/login" state={{ from }} onClick={onNavigate}>
                {t("account:login")}
              </Link>
            </li>
          )}
          <li>
            <Link
              to={publicPath(i18n.resolvedLanguage === "en" ? "en" : "ru")}
              onClick={onNavigate}
            >
              {t("nav.publicSite")}
            </Link>
          </li>
        </ul>
      </nav>
    );
  }
  if (!session.self) return null;
  const capabilities = session.self.capabilities;
  const current = matchRouteMeta(location.pathname);
  const report = t("nav.newReport");
  return (
    <>
      {canReport(capabilities) && (
        <Button asChild className="nav-new-report">
          <Link to={paths.newReport} onClick={onNavigate} title={tip(report)}>
            <NavIcon name="plus" />
            <span className="nav-label">{report}</span>
          </Link>
        </Button>
      )}
      <nav className="sidebar-navigation member-navigation" aria-label={t("nav.primary")}>
        {visibleGroups(capabilities).map((group) => {
          const titleId = `${prefix}-${group.id}`;
          return (
            <div key={group.id} className="nav-group">
              <p
                id={titleId}
                className={
                  group.id === "personal" ? "nav-group-title visually-hidden" : "nav-group-title"
                }
              >
                {t(`nav.groups.${group.id}`)}
              </p>
              <ul className="nav-list" aria-labelledby={titleId}>
                {group.items.map((entry) => {
                  const label = t(`nav.items.${entry.id}`);
                  const owned = current?.item === entry.id;
                  return (
                    <li key={entry.id}>
                      <Link
                        to={paths[entry.route]}
                        onClick={onNavigate}
                        title={tip(label)}
                        // A detail page is inside the section but is not the section page itself.
                        aria-current={
                          owned ? (current?.id === entry.route ? "page" : "true") : undefined
                        }
                      >
                        <NavIcon name={entry.id} />
                        <span className="nav-label">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}

export function Breadcrumb() {
  const { t } = useTranslation("core");
  const { pathname } = useLocation();
  const meta = matchRouteMeta(pathname);
  if (!meta) return null;
  const parent = meta.item ? navItem(meta.item) : undefined;
  return (
    <nav className="breadcrumb" aria-label={t("nav.breadcrumb")}>
      <ol>
        <li>{t(`nav.groups.${meta.group}`)}</li>
        {parent && parent.route !== meta.id && (
          <li>
            <Link to={paths[parent.route]}>{t(`nav.items.${parent.id}`)}</Link>
          </li>
        )}
        <li>
          <span aria-current="page">{t(meta.titleKey)}</span>
        </li>
      </ol>
    </nav>
  );
}

export function MemberSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("core");
  const session = useSession();
  const signOut = useSignOut();
  const toggle = t(collapsed ? "nav.expand" : "nav.collapse");
  return (
    <aside id="member-sidebar" className="member-sidebar" aria-label={t("nav.workspace")}>
      <div className="sidebar-top">
        <Link className="wordmark" to={paths.dashboard}>
          <span className="wordmark-full">Yukon Union</span>
          <span className="wordmark-short" aria-hidden="true">
            YU
          </span>
        </Link>
        {session.state !== "checking" && (
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!collapsed}
            aria-controls="member-sidebar"
            aria-label={toggle}
            title={toggle}
            onClick={onToggle}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
          </button>
        )}
      </div>
      {session.state !== "checking" && <MemberNavLinks collapsed={collapsed} />}
      {session.state === "authenticated" && !signOut.active && (
        <div className="sidebar-footer">
          <UserMenu placement="sidebar" />
        </div>
      )}
    </aside>
  );
}
