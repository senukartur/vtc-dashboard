import { type MouseEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router-dom";
import { publicContent, publicPath } from "../features/landing/content.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog.js";
import { Button } from "../shared/ui/primitives.js";
import { MemberNavLinks } from "./MemberNavigation.js";
import { landingPath } from "./navigation-model.js";
import { useSession } from "./Session.js";

export type MobileNavigate = (href: string, trigger: HTMLButtonElement | null) => void;
/** An unmodified primary click that the router handles in this tab; only these record focus intent. */
export function isPlainSelfClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!event.currentTarget.target || event.currentTarget.target === "_self")
  );
}
export function Navigation({
  variant = "public",
  onMobileNavigate,
}: {
  variant?: "public" | "sidebar" | "mobile";
  onMobileNavigate?: MobileNavigate;
}) {
  const { t, i18n } = useTranslation("core");
  const location = useLocation();
  const session = useSession();
  const preview = location.pathname.startsWith("/foundation") || location.pathname === "/status";
  const workspace = !preview && /^\/account(?:\/|$)/i.test(location.pathname);
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const c = publicContent[locale];
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = [
    { to: "/status", label: "readiness" },
    { to: "/foundation", label: "public" },
    { to: "/foundation/member", label: "member" },
  ];
  function links(close?: (event: MouseEvent<HTMLAnchorElement>) => void) {
    if (!preview)
      return [
        { to: `${publicPath(locale)}#about`, label: c.about },
        { to: `${publicPath(locale)}#apply`, label: c.apply },
        { to: `${publicPath(locale)}#contacts`, label: c.contacts },
        { to: "/events", label: c.events },
        {
          to: session.self ? landingPath : "/login",
          label: session.self ? t("nav.workspaceLink") : c.login,
        },
      ].map((item) => (
        <Link key={item.to} to={item.to} onClick={close}>
          {item.label}
        </Link>
      ));
    return items.map((item) => (
      <NavLink key={item.to} to={item.to} end onClick={close}>
        {t(item.label)}
      </NavLink>
    ));
  }
  function close(event: MouseEvent<HTMLAnchorElement>) {
    if (isPlainSelfClick(event)) onMobileNavigate?.(event.currentTarget.href, trigger.current);
    setOpen(false);
  }
  return (
    <>
      {variant !== "mobile" && (
        <nav
          className={variant === "sidebar" ? "sidebar-navigation" : "desktop-navigation"}
          aria-label={t("navigation")}
        >
          {links()}
        </nav>
      )}
      {variant !== "sidebar" && (
        <div className="mobile-navigation">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" ref={trigger}>
                {t("menu")}
              </Button>
            </DialogTrigger>
            <DialogContent className="navigation-dialog">
              <DialogTitle>{t("navigation")}</DialogTitle>
              <DialogDescription>Yukon Union</DialogDescription>
              {workspace ? (
                <MemberNavLinks onNavigate={close} />
              ) : (
                <nav className="dialog-navigation" aria-label={t("navigation")}>
                  {links(close)}
                </nav>
              )}
              <DialogClose asChild>
                <Button variant="outline">{t("close")}</Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}
