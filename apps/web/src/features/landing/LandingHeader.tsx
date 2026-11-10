import type { ReactNode } from "react";
import { type PublicLocale, publicContent, publicPath } from "./content.js";
import { LandingSectionLink, landingSections, PublicLink } from "./LandingSections.js";
import { logo } from "./media.js";

/** Shared by the prerendered document and the app; client-only controls arrive as slots. */
export function LandingHeader({
  locale,
  interactive = false,
  account,
  language,
  bell,
  menu,
}: {
  locale: PublicLocale;
  interactive?: boolean;
  account?: ReactNode;
  language?: ReactNode;
  bell?: ReactNode;
  menu?: ReactNode;
}) {
  const c = publicContent[locale];
  return (
    <header className="landing-header">
      <div className="landing-wrap landing-header-row">
        <PublicLink interactive={interactive} className="landing-brand" href={publicPath(locale)}>
          <img src={logo} alt="" width={30} height={30} />
          <span>Yukon Union</span>
        </PublicLink>
        <nav className="landing-header-links" aria-label={c.navSections}>
          {landingSections(c).map((section) => (
            <LandingSectionLink
              key={section.id}
              interactive={interactive}
              locale={locale}
              section={section.id}
              className="landing-nav-link"
            >
              {section.label}
            </LandingSectionLink>
          ))}
        </nav>
        <span className="landing-header-spacer" />
        {account}
        {language}
        {bell}
        <LandingSectionLink
          interactive={interactive}
          locale={locale}
          section="apply"
          className="landing-header-apply"
        >
          {c.apply}
        </LandingSectionLink>
        {/* Holds the space of the client menu button so the row never shifts. */}
        {menu ?? <span className="landing-menu-placeholder" aria-hidden="true" />}
      </div>
    </header>
  );
}
