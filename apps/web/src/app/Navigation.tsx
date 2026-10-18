import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog.js";
import { Button } from "../shared/ui/primitives.js";

export function Navigation({ variant = "public" }: { variant?: "public" | "sidebar" | "mobile" }) {
  const { t } = useTranslation("core");
  const [open, setOpen] = useState(false);
  const items = [
    { to: "/", label: "readiness" },
    { to: "/foundation", label: "public" },
    { to: "/foundation/member", label: "member" },
  ];
  function links(close?: () => void) {
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
              <DialogDescription>Yukon Union · {t("stage")}</DialogDescription>
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
