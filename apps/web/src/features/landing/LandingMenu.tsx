import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Button } from "../../shared/ui/primitives.js";
import { type PublicLocale, publicContent } from "./content.js";
import {
  focusSection,
  isPlainClick,
  type LandingSectionId,
  LandingSectionLink,
  landingSections,
} from "./LandingSections.js";

export type LandingMenuNavigate = (href: string, trigger: HTMLButtonElement | null) => void;

/**
 * Tablet and phone navigation as a modal top sheet. Radix supplies the focus trap, scroll lock,
 * Esc/outside dismissal and focus return; a section link hands focus to its section instead.
 */
export function LandingMenu({
  locale,
  account,
  language,
  onMobileNavigate,
}: {
  locale: PublicLocale;
  account: { to: string; label: string };
  language: ReactNode;
  onMobileNavigate?: LandingMenuNavigate;
}) {
  const { t } = useTranslation("core");
  const c = publicContent[locale];
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingSection = useRef<LandingSectionId | null>(null);
  const selectSection = (section: LandingSectionId) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (isPlainClick(event)) pendingSection.current = section;
    setOpen(false);
  };
  function selectRoute(event: MouseEvent<HTMLAnchorElement>) {
    if (isPlainClick(event)) onMobileNavigate?.(event.currentTarget.href, trigger.current);
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button ref={trigger} type="button" className="landing-menu-trigger" aria-label={t("menu")}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" focusable="false">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
            />
          </svg>
        </button>
      </DialogTrigger>
      <DialogContent
        className="navigation-dialog landing-menu"
        onOpenAutoFocus={(event) => {
          // Start on the first section link rather than the sheet itself.
          const first = document.querySelector<HTMLElement>(".landing-menu .dialog-navigation a");
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        onCloseAutoFocus={(event) => {
          const section = pendingSection.current;
          if (!section) return;
          pendingSection.current = null;
          event.preventDefault();
          focusSection(section);
        }}
      >
        <DialogTitle>{t("navigation")}</DialogTitle>
        <DialogDescription>Yukon Union</DialogDescription>
        <nav className="dialog-navigation" aria-label={t("navigation")}>
          {landingSections(c).map((section) => (
            <LandingSectionLink
              key={section.id}
              interactive
              locale={locale}
              section={section.id}
              onSelect={selectSection(section.id)}
            >
              {section.label}
            </LandingSectionLink>
          ))}
          <Link to={account.to} onClick={selectRoute}>
            {account.label}
          </Link>
        </nav>
        {language}
        <DialogClose asChild>
          <Button variant="outline">{t("close")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
