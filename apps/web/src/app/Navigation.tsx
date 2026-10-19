import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog.js";
import { publicContent, publicPath } from "../features/landing/content.js";
import { Button } from "../shared/ui/primitives.js";

export function Navigation({ variant = "public" }: { variant?: "public" | "sidebar" | "mobile" }) {
  const { t, i18n } = useTranslation("core");
  const location = useLocation();
  const preview = location.pathname.startsWith("/foundation") || location.pathname === "/status";
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const c = publicContent[locale];
  const [open, setOpen] = useState(false);
  const items = [
    { to: "/status", label: "readiness" },
    { to: "/foundation", label: "public" },
    { to: "/foundation/member", label: "member" },
  ];
  function links(close?: () => void) {
    if (!preview)
      return [
        { to: `${publicPath(locale)}#about`, label: c.about },
        { to: `${publicPath(locale)}#apply`, label: c.apply },
        { to: `${publicPath(locale)}#contacts`, label: c.contacts },
        { to: "/events", label: c.events },
        { to: "/login", label: c.login },
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
              <Button variant="outline">{t("menu")}</Button>
            </DialogTrigger>
            <DialogContent className="navigation-dialog">
              <DialogTitle>{t("navigation")}</DialogTitle>
              <DialogDescription>Yukon Union</DialogDescription>
              <nav aria-label={t("navigation")}>{links(() => setOpen(false))}</nav>
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
