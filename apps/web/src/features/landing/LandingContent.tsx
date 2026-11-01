import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { publicContacts, publicContent, type PublicLocale, publicPath } from "./content.js";
import { HeroArt } from "./HeroArt.js";
import "./landing.css";

export type LandingMotion = "static" | "running" | "paused";

/**
 * Shared public copy for the build-time document and interactive page. Time-dependent and
 * fetched parts arrive only through the client slots, so the prerendered output depends on
 * the locale and static content alone.
 */
export function LandingContent({
  locale,
  application,
  events,
  heroChip,
  heroControls,
  ticker,
  stats,
  motion = "static",
  interactive = false,
}: {
  locale: PublicLocale;
  application?: ReactNode;
  events?: ReactNode;
  heroChip?: ReactNode;
  heroControls?: ReactNode;
  ticker?: ReactNode;
  stats?: ReactNode;
  motion?: LandingMotion;
  interactive?: boolean;
}) {
  const c = publicContent[locale];
  return (
    <div className="landing" data-motion={motion}>
      <section className="landing-hero" aria-labelledby="landing-title">
        {heroChip}
        <p className="eyebrow">{c.eyebrow}</p>
        <h1 id="landing-title">{c.heading}</h1>
        <p className="lead">{c.intro}</p>
        <div className="heading-actions">
          <PublicLink
            interactive={interactive}
            className="button button-primary"
            href={`${publicPath(locale)}#apply`}
          >
            {c.apply} <span aria-hidden="true">↗</span>
          </PublicLink>
          <PublicLink interactive={interactive} className="button button-outline" href="/events">
            {c.events}
          </PublicLink>
        </div>
        {heroControls}
        <HeroArt />
      </section>
      {ticker}
      {stats}
      {events ?? (
        <section className="landing-section">
          <h2>{c.events}</h2>
          <PublicLink interactive={interactive} className="button button-outline" href="/events">
            {c.events}
          </PublicLink>
        </section>
      )}
      <section id="about" className="landing-section" aria-labelledby="about-title">
        <p className="eyebrow">Yukon Union</p>
        <h2 id="about-title">{c.aboutTitle}</h2>
        <div className="landing-values">
          {c.values.map((value, index) => (
            <article key={value.title}>
              <span className="value-number" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{value.title}</h3>
              <p>{value.text}</p>
            </article>
          ))}
        </div>
        <div className="landing-ladder">
          <h3 id="landing-ladder-title">{c.ladderTitle}</h3>
          <ol aria-labelledby="landing-ladder-title">
            {c.ladder.map((level, index) => (
              <li key={level.name}>
                <span className="landing-ladder-mark" aria-hidden="true">
                  <span className="landing-ladder-number">{index + 1}</span>
                  <span className="landing-ladder-line" />
                </span>
                <strong>{level.name}</strong>
                {level.text && <span className="landing-ladder-text">{level.text}</span>}
              </li>
            ))}
          </ol>
          <p className="muted">{c.ladderNote}</p>
        </div>
      </section>
      <section id="apply" className="landing-section application-grid" aria-labelledby="join-title">
        <div className="join-copy">
          <p className="eyebrow">{c.requirements}</p>
          <h2 id="join-title">{c.requirementsTitle}</h2>
          <ol className="landing-steps">
            {c.joinSteps.map((step, index) => (
              <li key={step.title}>
                <span className="landing-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="muted">{c.joinNote}</p>
        </div>
        {application ?? <p>{c.noScript}</p>}
      </section>
      <section id="contacts" className="landing-section" aria-labelledby="contacts-title">
        <h2 id="contacts-title">{c.contactsTitle}</h2>
        <p className="lead">{c.contactsText}</p>
        <ul className="contact-links">
          {publicContacts.map((contact) => (
            <li key={contact.label}>
              <a href={contact.href} rel="noreferrer">
                {contact.label} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
          <li>
            <a href="https://ykn-u.ru/portal/contact" rel="noreferrer">
              {c.contactPage} <span aria-hidden="true">↗</span>
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
function PublicLink({
  interactive,
  href,
  children,
  className,
}: {
  interactive: boolean;
  href: string;
  children: ReactNode;
  className: string;
}) {
  return interactive ? (
    <Link className={className} to={href}>
      {children}
    </Link>
  ) : (
    <a className={className} href={href}>
      {children}
    </a>
  );
}
