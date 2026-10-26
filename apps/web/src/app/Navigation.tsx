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
import { useSession } from "./Session.js";

export type MobileNavigate = (href: string, trigger: HTMLButtonElement | null) => void;
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
    if (!preview && location.pathname.startsWith("/account"))
      return (
        <>
          <NavLink to="/account" end onClick={close}>
            {t("account:account")}
          </NavLink>
          {session.self?.capabilities.includes("company.read") && (
            <NavLink to="/account/catalogs" onClick={close}>
              {t("catalogs:title")}
            </NavLink>
          )}
          {session.self?.capabilities.includes("company.read") && (
            <NavLink to="/account/qualifications" onClick={close}>
              {t("qualifications:title")}
            </NavLink>
          )}
          {[
            ["company.read", "/account/trips", "title"],
            ["trips.submit_own", "/account/reports", "drafts"],
            ["trips.review", "/account/review", "review"],
          ]
            .filter(([cap]) => cap && session.self?.capabilities.includes(cap))
            .map(([, path, label]) => (
              <NavLink key={path} to={path ?? "/account/trips"} onClick={close}>
                {t(`trips:${label}`)}
              </NavLink>
            ))}
          {[
            ["company.read", "/account/connections", "connections"],
            ["applications.manage", "/account/admin/applications", "applications"],
            ["members.manage", "/account/admin/members", "members"],
            ["company.configure", "/account/admin/settings", "settings"],
          ]
            .filter(([cap]) => cap && session.self?.capabilities.includes(cap))
            .map(([, path, label]) => (
              <NavLink key={path} to={path ?? "/account"} onClick={close}>
                {t(`administration:${label}`)}
              </NavLink>
            ))}
          <Link to={publicPath(locale)} onClick={close}>
            {t("home")}
          </Link>
          {[["company.read", "dashboard"]]
            .filter(([capability]) => capability && session.self?.capabilities.includes(capability))
            .map(([, label]) => (
              <span className="unavailable-navigation" key={label}>
                {t(`account:nav.${label}`)} · {t("account:unavailable")}
              </span>
            ))}
        </>
      );
    if (!preview)
      return [
        { to: `${publicPath(locale)}#about`, label: c.about },
        { to: `${publicPath(locale)}#apply`, label: c.apply },
        { to: `${publicPath(locale)}#contacts`, label: c.contacts },
        { to: "/events", label: c.events },
        {
          to: session.self ? "/account" : "/login",
          label: session.self ? t("account:account") : c.login,
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
              <nav aria-label={t("navigation")}>
                {links((event) => {
                  if (
                    !event.defaultPrevented &&
                    event.button === 0 &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey &&
                    !event.altKey &&
                    (!event.currentTarget.target || event.currentTarget.target === "_self")
                  )
                    onMobileNavigate?.(event.currentTarget.href, trigger.current);
                  setOpen(false);
                })}
              </nav>
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
