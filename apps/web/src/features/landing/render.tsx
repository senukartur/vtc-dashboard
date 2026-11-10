import { renderToStaticMarkup } from "react-dom/server";
import { type PublicLocale, publicContent, publicPath } from "./content.js";
import { LandingContent } from "./LandingContent.js";
import { LandingFooter } from "./LandingFooter.js";
import { LandingHeader } from "./LandingHeader.js";

/** Build-time document: the same header, content and footer as the app, without client slots. */
export function renderPublic(locale: PublicLocale) {
  const c = publicContent[locale];
  const other = locale === "ru" ? "en" : "ru";
  return renderToStaticMarkup(
    <div className="landing-shell">
      <a className="skip-link" href="#main-content">
        {locale === "ru" ? "Перейти к содержимому" : "Skip to content"}
      </a>
      <LandingHeader
        locale={locale}
        account={
          <a className="landing-header-signin" href="/login">
            {c.login}
          </a>
        }
        language={
          <a className="landing-header-language" href={publicPath(other)} lang={other}>
            {locale === "ru" ? "English" : "Русский"}
          </a>
        }
      />
      <main id="main-content" tabIndex={-1}>
        <LandingContent locale={locale} />
      </main>
      <LandingFooter locale={locale} />
    </div>,
  );
}
export { publicContent };
