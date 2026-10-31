import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSignOut } from "../features/account/sign-out.js";
import { publicPath } from "../features/landing/content.js";
import { NavIcon } from "./nav-icons.js";
import { paths, primaryRole } from "./navigation-model.js";
import { useSession } from "./Session.js";

/**
 * Personal destinations, display language and sign-out. Rendered in the sidebar footer above
 * 1050px and in the topbar below it; CSS hides the other instance so only one is exposed.
 */
export function UserMenu({ placement }: { placement: "sidebar" | "topbar" }) {
  const { t, i18n } = useTranslation("core");
  const session = useSession();
  const signOut = useSignOut();
  // Path at the moment a routed item was chosen; the shell focuses main after a route change.
  const routedFrom = useRef<string | null>(null);
  // Sign-out hides this trigger, so focus moves to main where the sign-out status renders.
  const ending = useRef(false);
  const self = session.self;
  if (!self) return null;
  const role = primaryRole(self.member.roles);
  const roleLabel = role ? t(`administration:${role}`) : "";
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const routed = () => {
    routedFrom.current = window.location.pathname;
  };
  const item = "user-menu-item";
  return (
    <div className={`user-menu user-menu-${placement}`}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="user-menu-trigger"
            aria-label={[self.member.nickname, roleLabel, t("nav.userMenu")]
              .filter(Boolean)
              .join(" · ")}
          >
            <span className="user-avatar" aria-hidden="true">
              {Array.from(self.member.nickname)[0]?.toLocaleUpperCase() ?? "?"}
            </span>
            <span className="user-identity">
              <span className="user-name">{self.member.nickname}</span>
              {roleLabel && <span className="user-role">{roleLabel}</span>}
            </span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="user-menu-content"
            side={placement === "sidebar" ? "top" : "bottom"}
            align={placement === "sidebar" ? "start" : "end"}
            sideOffset={6}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              const from = routedFrom.current;
              routedFrom.current = null;
              if (ending.current) {
                ending.current = false;
                event.preventDefault();
                document.getElementById("main-content")?.focus();
              } else if (from !== null && from !== window.location.pathname) event.preventDefault();
            }}
          >
            <DropdownMenu.Label className="user-menu-label">
              <span className="user-name">{self.member.nickname}</span>
              <span className="user-email">{self.email}</span>
            </DropdownMenu.Label>
            {self.capabilities.includes("company.read") && (
              <DropdownMenu.Item asChild className={item} onSelect={routed}>
                <Link to={`/account/drivers/${encodeURIComponent(self.member.id)}`}>
                  {t("nav.myProfile")}
                </Link>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item asChild className={item} onSelect={routed}>
              <Link to={paths.account}>{t("nav.account.security")}</Link>
            </DropdownMenu.Item>
            {self.capabilities.includes("company.read") && (
              <DropdownMenu.Item asChild className={item} onSelect={routed}>
                <Link to={paths.connections}>{t("nav.account.connections")}</Link>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="user-menu-separator" />
            <DropdownMenu.Label className="user-menu-heading">{t("language")}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={locale}
              onValueChange={(value) => void i18n.changeLanguage(value)}
            >
              {(
                [
                  ["ru", "Русский"],
                  ["en", "English"],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenu.RadioItem key={value} value={value} className={item} lang={value}>
                  <span className="user-menu-indicator">
                    <DropdownMenu.ItemIndicator>
                      <NavIcon name="check" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="user-menu-separator" />
            <DropdownMenu.Item asChild className={item} onSelect={routed}>
              <Link to={publicPath(locale)}>{t("nav.publicSite")}</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={item}
              onSelect={() => {
                ending.current = true;
                void signOut.start();
              }}
            >
              {t("account:logout")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
