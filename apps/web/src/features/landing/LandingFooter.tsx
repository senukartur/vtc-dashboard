import fontLicenseUrl from "../../../../../third_party/huninn/OFL.txt?url";
import { type PublicLocale, publicContent } from "./content.js";
import { PublicLink } from "./LandingSections.js";

export function LandingFooter({
  locale,
  interactive = false,
}: {
  locale: PublicLocale;
  interactive?: boolean;
}) {
  const c = publicContent[locale];
  return (
    <footer className="landing-footer">
      <div className="landing-wrap landing-footer-row">
        <span className="landing-footer-note">{c.footerNote}</span>
        <PublicLink interactive={interactive} href="/status">
          {c.statusLink}
        </PublicLink>
        <a href={fontLicenseUrl}>{c.fontLicense}</a>
      </div>
    </footer>
  );
}
