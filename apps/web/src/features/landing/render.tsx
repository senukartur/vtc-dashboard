import { renderToStaticMarkup } from "react-dom/server";
import { LandingContent } from "./LandingContent.js";
import { publicContent, type PublicLocale, publicPath } from "./content.js";
export function renderPublic(locale: PublicLocale) {
  const c = publicContent[locale];
  return renderToStaticMarkup(
    <div className="app-shell public-shell">
      <a className="skip-link" href="#main-content">
        {locale === "ru" ? "Перейти к содержимому" : "Skip to content"}
      </a>
      <header className="site-header">
        <a className="wordmark" href={publicPath(locale)}>
          Yukon Union
        </a>
        <nav
          className="desktop-navigation"
          aria-label={locale === "ru" ? "Навигация" : "Navigation"}
        >
          <a href="#about">{c.about}</a>
          <a href="#apply">{c.apply}</a>
          <a href="#contacts">{c.contacts}</a>
          <a href="/events">{c.events}</a>
          <a href="/login">{c.login}</a>
        </nav>
        <a href={publicPath(locale === "ru" ? "en" : "ru")} lang={locale === "ru" ? "en" : "ru"}>
          {locale === "ru" ? "English" : "Русский"}
        </a>
      </header>
      <main id="main-content" tabIndex={-1}>
        <LandingContent locale={locale} />
      </main>
      <footer className="site-footer">Yukon Union · ETS2 / ATS</footer>
    </div>,
  );
}
export { publicContent };
