import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useSignOut } from "../features/account/sign-out.js";
import { publicPath } from "../features/landing/content.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog.js";
import { SegmentedControl } from "../shared/ui/segmented-control.js";
import { MemberNavLinks } from "./MemberNavigation.js";
import { isPlainSelfClick, type MobileNavigate } from "./Navigation.js";
import { NavIcon } from "./nav-icons.js";
import {
  accountLinks,
  bottomBarItems,
  currentMarker,
  matchRouteMeta,
  paths,
  primaryRole,
} from "./navigation-model.js";
import { useSession } from "./Session.js";

const languages = [
  { value: "ru", label: "Русский", lang: "ru" },
  { value: "en", label: "English", lang: "en" },
] as const;

/**
 * Phone-only (below 768px) bottom bar with the main sections and a More sheet holding the
 * remaining permission-filtered sections and account items. CSS hides it from 768px.
 */
export function BottomNavigation({ onMobileNavigate }: { onMobileNavigate: MobileNavigate }) {
  const { t, i18n } = useTranslation("core");
  const session = useSession();
  const signOut = useSignOut();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Sign-out removes the bar and its trigger, so focus moves to main where the status renders.
  const ending = useRef(false);
  const languageId = useId();
  useEffect(() => {
    // Growing past the phone breakpoint hides the bar; close the sheet instead of stranding it.
    const wide = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  const self = session.self;
  if (!self) return null;
  const capabilities = self.capabilities;
  const meta = matchRouteMeta(location.pathname);
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const role = primaryRole(self.member.roles);
  function choose(event: MouseEvent<HTMLAnchorElement>) {
    // The shell returns focus to More after the route change, or to main if More is gone.
    if (isPlainSelfClick(event)) onMobileNavigate(event.currentTarget.href, trigger.current);
    setOpen(false);
  }
  return (
    <nav className="bottom-nav" aria-label={t("nav.sections")}>
      <ul>
        {bottomBarItems(capabilities).map((entry) => {
          const label = t(entry.labelKey);
          return (
            <li key={entry.id}>
              <Link
                to={paths[entry.route]}
                className={entry.accent ? "bottom-nav-item bottom-nav-accent" : "bottom-nav-item"}
                aria-label={entry.nameKey ? t(entry.nameKey) : undefined}
                aria-current={currentMarker(entry, meta)}
              >
                <span className="bottom-nav-icon">
                  <NavIcon name={entry.id === "newReport" ? "plus" : entry.id} size={20} />
                </span>
                <span className="bottom-nav-label">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button type="button" className="bottom-nav-item" ref={trigger}>
                <span className="bottom-nav-icon">
                  <NavIcon name="more" size={20} />
                </span>
                <span className="bottom-nav-label">{t("nav.more")}</span>
              </button>
            </DialogTrigger>
            <DialogContent
              className="more-sheet"
              onCloseAutoFocus={(event) => {
                const target = trigger.current;
                if (
                  ending.current ||
                  !target?.isConnected ||
                  target.getClientRects().length === 0
                ) {
                  ending.current = false;
                  event.preventDefault();
                  document.getElementById("main-content")?.focus();
                }
              }}
            >
              <div className="more-sheet-header">
                <DialogTitle>{t("nav.more")}</DialogTitle>
                <DialogClose asChild>
                  <button type="button" className="more-sheet-close">
                    {t("close")}
                  </button>
                </DialogClose>
              </div>
              <DialogDescription className="visually-hidden">
                {t("nav.moreDescription")}
              </DialogDescription>
              <MemberNavLinks variant="sheet" onNavigate={choose} />
              <div className="more-account">
                <div className="more-identity">
                  <span className="user-avatar" aria-hidden="true">
                    {Array.from(self.member.nickname)[0]?.toLocaleUpperCase() ?? "?"}
                  </span>
                  <span className="user-identity">
                    <span className="user-name">{self.member.nickname}</span>
                    {role && <span className="user-role">{t(`administration:${role}`)}</span>}
                    <span className="user-email">{self.email}</span>
                  </span>
                </div>
                <ul className="nav-list more-links" aria-label={t("nav.groups.account")}>
                  {accountLinks({ capabilities, memberId: self.member.id }).map((entry) => (
                    <li key={entry.id}>
                      <Link to={entry.to} onClick={choose}>
                        {t(entry.labelKey)}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="nav-group more-language">
                  <p id={languageId} className="nav-group-title">
                    {t("language")}
                  </p>
                  {/* Per-session switch; the saved preference stays on the Account page. */}
                  <SegmentedControl
                    aria-labelledby={languageId}
                    size="sm"
                    value={locale}
                    options={languages}
                    onValueChange={(value) => void i18n.changeLanguage(value)}
                  />
                </div>
                <div className="more-links">
                  <Link to={publicPath(locale)} onClick={choose}>
                    {t("nav.publicSite")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      ending.current = true;
                      setOpen(false);
                      void signOut.start();
                    }}
                  >
                    {t("account:logout")}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </li>
      </ul>
    </nav>
  );
}
