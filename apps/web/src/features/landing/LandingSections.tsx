import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { type PublicLocale, publicContacts, type publicContent, publicPath } from "./content.js";
import {
  aboutConvoy320,
  aboutConvoy640,
  aboutParking480,
  aboutParking960,
  cab828,
  cab1280,
  cab2000,
  iconHaulmp,
  iconTruckersmp,
  iconTrucky,
} from "./media.js";

type Copy = (typeof publicContent)[PublicLocale];
export type LandingSectionId = "convoys" | "events" | "about" | "ranks" | "apply";

/** Header and menu order of the in-page sections. */
export function landingSections(c: Copy): { id: LandingSectionId; label: string }[] {
  return [
    { id: "convoys", label: c.navConvoys },
    { id: "events", label: c.navEvents },
    { id: "about", label: c.about },
    { id: "ranks", label: c.navRanks },
    { id: "apply", label: c.requirements },
  ];
}

/** An unmodified primary click that stays in this tab. */
export function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!event.currentTarget.target || event.currentTarget.target === "_self")
  );
}

/** Moves focus to a section and scrolls it into view, also when its hash is already current. */
export function focusSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
}

export function PublicLink({
  interactive,
  href,
  children,
  className,
}: {
  interactive: boolean;
  href: string;
  children: ReactNode;
  className?: string;
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

export function LandingSectionLink({
  interactive,
  locale,
  section,
  className,
  onSelect,
  children,
}: {
  interactive: boolean;
  locale: PublicLocale;
  section: LandingSectionId;
  className?: string;
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  if (!interactive)
    return (
      <a className={className} href={`#${section}`}>
        {children}
      </a>
    );
  return (
    <Link
      className={className}
      to={`${publicPath(locale)}#${section}`}
      onClick={(event) => {
        if (onSelect) onSelect(event);
        else if (isPlainClick(event)) focusSection(section);
      }}
    >
      {children}
    </Link>
  );
}

const sectionNumber = (index: number) => String(index + 1).padStart(2, "0");

export function EventFormats({ c }: { c: Copy }) {
  return (
    <section
      id="events"
      tabIndex={-1}
      className="landing-section landing-wrap"
      aria-labelledby="landing-events-title"
    >
      <div className="landing-section-head">
        <div>
          <p className="landing-eyebrow">{c.eventsEyebrow}</p>
          <h2 id="landing-events-title">{c.eventsTitle}</h2>
        </div>
        <p className="landing-section-text">{c.eventsText}</p>
      </div>
      <ul className="landing-event-grid">
        {c.eventFormats.map((name, index) => (
          <li key={name} className="landing-event-tile">
            <span className="landing-event-number" aria-hidden="true">
              {sectionNumber(index)}
            </span>
            <span className="landing-event-name">{name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CabView({ c }: { c: Copy }) {
  return (
    <section className="landing-cab-section" aria-labelledby="landing-cab-title">
      <figure className="landing-cab">
        <img
          className="landing-cab-image landing-motion"
          src={cab1280}
          srcSet={`${cab828} 828w, ${cab1280} 1280w, ${cab2000} 2000w`}
          sizes="max(100vw, 758px)"
          width={2000}
          height={844}
          loading="lazy"
          decoding="async"
          alt={c.cabAlt}
        />
        <span className="landing-cab-sun landing-motion" aria-hidden="true" />
        <span className="landing-cab-sweep landing-motion" aria-hidden="true" />
        <span className="landing-cab-fade" aria-hidden="true" />
        <figcaption className="landing-cab-caption">
          <div className="landing-wrap landing-cab-copy">
            <h2 id="landing-cab-title">{c.cabTitle}</h2>
            <p className="landing-cab-chips">
              <span className="landing-cab-chip">
                <span className="landing-chip-dot landing-motion" aria-hidden="true" />
                {c.cabTelemetry}
              </span>
              <span className="landing-cab-chip">
                <strong>{c.cabSpeedValue}</strong>&nbsp;{c.cabSpeedText}
              </span>
            </p>
          </div>
        </figcaption>
      </figure>
    </section>
  );
}

export function AboutSection({ c }: { c: Copy }) {
  return (
    <section
      id="about"
      tabIndex={-1}
      className="landing-section landing-wrap"
      aria-labelledby="about-title"
    >
      <div className="landing-about">
        <div className="landing-about-copy">
          <div>
            <p className="landing-eyebrow">{c.aboutEyebrow}</p>
            <h2 id="about-title">{c.aboutTitle}</h2>
          </div>
          <p className="landing-about-text">{c.aboutText}</p>
          <ul className="landing-facts">
            {c.facts.map((fact) => (
              <li key={fact.title}>
                <span className="landing-fact-mark" aria-hidden="true">
                  <svg
                    aria-hidden="true"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    focusable="false"
                  >
                    <path
                      d="M5 12l5 5 9-10"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="3"
                    />
                  </svg>
                </span>
                <span>
                  <strong>{fact.title}</strong> — {fact.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* Both company photos form one group so it can be removed as a unit. */}
        <div className="landing-about-photos">
          <figure className="landing-photo landing-photo-main">
            <img
              src={aboutParking960}
              srcSet={`${aboutParking480} 480w, ${aboutParking960} 960w`}
              sizes="(max-width: 760px) 88vw, 480px"
              width={960}
              height={540}
              loading="lazy"
              decoding="async"
              alt={c.aboutParkingAlt}
            />
            <figcaption>{c.aboutParkingCaption}</figcaption>
          </figure>
          <figure className="landing-photo landing-photo-inset">
            <img
              src={aboutConvoy640}
              srcSet={`${aboutConvoy320} 320w, ${aboutConvoy640} 640w`}
              sizes="(max-width: 760px) 50vw, 280px"
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              alt={c.aboutConvoyAlt}
            />
          </figure>
        </div>
      </div>
    </section>
  );
}

export function RanksSection({ c }: { c: Copy }) {
  return (
    <section
      id="ranks"
      tabIndex={-1}
      className="landing-section landing-wrap"
      aria-labelledby="ranks-title"
    >
      <div className="landing-section-head">
        <div>
          <p className="landing-eyebrow">{c.ranksEyebrow}</p>
          <h2 id="ranks-title" className="landing-ranks-title">
            {c.ranksLead} <span className="landing-aurora-text">{c.ranksAccent}</span>
          </h2>
        </div>
        <p className="landing-section-text">{c.ranksText}</p>
      </div>
      <div className="landing-ranks-card">
        <ol className="landing-ranks">
          {c.ranks.map((name, index) => (
            <li key={name} className="landing-rank" style={{ "--rank": index } as CSSProperties}>
              <span className="landing-rank-bar" aria-hidden="true" />
              <span className="landing-rank-number" aria-hidden="true">
                {sectionNumber(index)}
              </span>
              <span className="landing-rank-name">{name}</span>
            </li>
          ))}
        </ol>
        <p className="landing-ranks-note">{c.ranksNote}</p>
      </div>
    </section>
  );
}

export function JoinSection({ c, application }: { c: Copy; application?: ReactNode }) {
  return (
    <section id="apply" tabIndex={-1} className="landing-join" aria-labelledby="join-title">
      <div className="landing-wrap landing-join-row">
        <div className="join-copy">
          <p className="landing-eyebrow">{c.requirements}</p>
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
        <div className="landing-join-form">{application ?? <p>{c.noScript}</p>}</div>
      </div>
    </section>
  );
}

const svgIcons = {
  steam:
    "M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z",
  discord:
    "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  vk: "m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z",
} as const;
const imageIcons = { truckersmp: iconTruckersmp, haulmp: iconHaulmp, trucky: iconTrucky } as const;

function ContactIcon({ icon }: { icon: (typeof publicContacts)[number]["icon"] }) {
  return (
    <span className="landing-contact-icon" data-icon={icon} aria-hidden="true">
      {icon in imageIcons ? (
        <img src={imageIcons[icon as keyof typeof imageIcons]} alt="" width={28} height={28} />
      ) : (
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" focusable="false">
          <path d={svgIcons[icon as keyof typeof svgIcons]} fill="#FFFFFF" />
        </svg>
      )}
    </span>
  );
}

export function ContactsSection({ c }: { c: Copy }) {
  return (
    <section
      id="contacts"
      tabIndex={-1}
      className="landing-contacts landing-wrap"
      aria-labelledby="contacts-title"
    >
      <h2 id="contacts-title">{c.contactsTitle}</h2>
      <ul className="landing-contact-grid">
        {publicContacts.map((contact) => (
          <li key={contact.label}>
            <a className="landing-contact" href={contact.href} rel="noreferrer">
              <ContactIcon icon={contact.icon} />
              <span className="landing-contact-label">{contact.label}</span>
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" focusable="false">
                <path
                  d="M7 17L17 7M9 7h8v8"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
