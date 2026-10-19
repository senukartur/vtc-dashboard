import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { publicContacts, publicContent, type PublicLocale, publicPath } from "./content.js";

/** Shared public copy for the build-time document and interactive page. */
export function LandingContent({
  locale,
  application,
  interactive = false,
}: {
  locale: PublicLocale;
  application?: ReactNode;
  interactive?: boolean;
}) {
  const c = publicContent[locale];
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
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
        <div className="road-line" aria-hidden="true">
          <span>ETS2</span>
          <span>YUKON UNION</span>
          <span>ATS</span>
        </div>
      </section>
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
      </section>
      <section id="apply" className="landing-section application-grid" aria-labelledby="join-title">
        <div className="join-copy">
          <p className="eyebrow">{c.requirements}</p>
          <h2 id="join-title">{c.requirementsTitle}</h2>
          <p>{c.requirementsText}</p>
          <p className="muted">{c.review}</p>
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
