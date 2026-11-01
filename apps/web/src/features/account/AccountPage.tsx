import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";
import { paths, primaryRole } from "../../app/navigation-model.js";
import { useSession } from "../../app/Session.js";
import { PreferencesSection } from "./PreferencesSection.js";
import { ProfileSection } from "./ProfileSection.js";
import { SecuritySection } from "./SecuritySection.js";
import {
  type AccountSectionId,
  accountSections,
  legacyAccountSection,
  visibleAccountSections,
} from "./settings.js";
import "./account.css";

const ConnectionsSection = lazy(() =>
  import("../connections/ConnectionsSection.js").then((module) => ({
    default: module.ConnectionsSection,
  })),
);

/** `/account` opens Security; anchors of the former single page land in their section. */
export function AccountIndex() {
  const { search, hash } = useLocation();
  const target = legacyAccountSection(hash);
  const to = accountSections.find((section) => section.id === target)?.to ?? paths.accountSecurity;
  return <Navigate replace to={{ pathname: to, search }} />;
}

function SectionNavigation({ current }: { current: AccountSectionId }) {
  const { t } = useTranslation("account");
  const session = useSession();
  const self = session.self;
  if (!self) return null;
  return (
    <nav className="account-sections-nav" aria-label={t("accountSections")}>
      <ul className="account-sections-list">
        {visibleAccountSections(self.capabilities).map((section) => {
          const attention = section.id === "security" && !self.emailVerified;
          return (
            <li key={section.id}>
              <Link
                className="account-section-link"
                to={section.to}
                aria-current={section.id === current ? "page" : undefined}
              >
                <span className="account-section-label">{t(`sections.${section.id}`)}</span>
                {attention && (
                  <>
                    <span className="account-attention" aria-hidden="true" />
                    <span className="visually-hidden"> {t("needsAttention")}</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AccountPage({ section }: { section: AccountSectionId }) {
  const session = useSession();
  const { t } = useTranslation(["account", "core"]);
  const self = session.self;
  if (!self) return null;
  const role = primaryRole(self.member.roles);
  return (
    <div className="account-page account-settings">
      <div className="account-settings-aside">
        <div className="account-identity">
          <span className="user-avatar" aria-hidden="true">
            {Array.from(self.member.nickname)[0]?.toUpperCase()}
          </span>
          <span className="account-identity-text">
            <span className="account-identity-name">{self.member.nickname}</span>
            {role && <span className="account-identity-role">{t(`administration:${role}`)}</span>}
          </span>
        </div>
        <SectionNavigation current={section} />
      </div>
      <div className="account-settings-content">
        <header className="page-heading">
          <h1>{t(`sections.${section}`)}</h1>
          <p className="muted">{t(`sectionLeads.${section}`)}</p>
        </header>
        {section === "profile" ? (
          <ProfileSection self={self} />
        ) : section === "security" ? (
          <SecuritySection self={self} />
        ) : section === "preferences" ? (
          <PreferencesSection self={self} etag={session.etag} />
        ) : (
          <Suspense
            fallback={
              <p role="status" aria-busy="true">
                {t("core:loadingView")}
              </p>
            }
          >
            <ConnectionsSection />
          </Suspense>
        )}
      </div>
    </div>
  );
}
