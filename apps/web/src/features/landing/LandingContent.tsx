import type { ReactNode } from "react";
import { type PublicLocale, publicContent } from "./content.js";
import {
  AboutSection,
  CabView,
  ContactsSection,
  EventFormats,
  JoinSection,
  LandingSectionLink,
  PublicLink,
  RanksSection,
} from "./LandingSections.js";
import { heroStill854, heroStill1280 } from "./media.js";
import "./landing.css";

export type LandingMotion = "static" | "running" | "paused";

/**
 * Shared public copy for the build-time document and interactive page. Time-dependent, fetched
 * and media-playback parts arrive only through the client slots, so the prerendered output
 * depends on the locale and static content alone.
 */
export function LandingContent({
  locale,
  application,
  events,
  heroChip,
  heroControls,
  heroVideo,
  stats,
  motion = "static",
  interactive = false,
}: {
  locale: PublicLocale;
  application?: ReactNode;
  events?: ReactNode;
  heroChip?: ReactNode;
  heroControls?: ReactNode;
  heroVideo?: ReactNode;
  stats?: ReactNode;
  motion?: LandingMotion;
  interactive?: boolean;
}) {
  const c = publicContent[locale];
  return (
    <div className="landing" data-motion={motion}>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-frame">
          <picture>
            <source media="(max-width: 760px)" srcSet={heroStill854} />
            <img
              className="landing-hero-still"
              src={heroStill1280}
              width={1280}
              height={720}
              fetchPriority="high"
              decoding="sync"
              alt={c.heroAlt}
            />
          </picture>
          {heroVideo}
          <span className="landing-hero-fade" aria-hidden="true" />
        </div>
        <div className="landing-wrap landing-hero-copy">
          {/* Always reserved, so the slogan never moves when the countdown appears or not. */}
          <div className="landing-chip-slot">{heroChip}</div>
          <h1 id="landing-title">
            <span>{c.headingLead}</span>{" "}
            <span className="landing-aurora-text landing-heading-accent">{c.headingAccent}</span>
          </h1>
          <p className="landing-lead">{c.intro}</p>
          <div className="landing-hero-actions">
            <LandingSectionLink
              interactive={interactive}
              locale={locale}
              section="apply"
              className="landing-cta landing-cta-primary"
            >
              {c.apply}
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" focusable="false">
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.4"
                />
              </svg>
            </LandingSectionLink>
            <LandingSectionLink
              interactive={interactive}
              locale={locale}
              section="convoys"
              className="landing-cta landing-cta-outline"
            >
              {c.heroConvoys}
            </LandingSectionLink>
            {heroControls}
          </div>
          {stats}
        </div>
      </section>
      {events ?? (
        <section
          id="convoys"
          tabIndex={-1}
          className="landing-section landing-wrap"
          aria-labelledby="landing-convoys-title"
        >
          <header className="landing-section-head">
            <div>
              <p className="landing-eyebrow">{c.convoysEyebrow}</p>
              <h2 id="landing-convoys-title">{c.convoysTitle}</h2>
            </div>
            <PublicLink interactive={interactive} className="landing-convoys-link" href="/events">
              {c.allEvents} <span aria-hidden="true">→</span>
            </PublicLink>
          </header>
        </section>
      )}
      <EventFormats c={c} />
      <CabView c={c} />
      <AboutSection c={c} />
      <RanksSection c={c} />
      <JoinSection c={c} application={application} />
      <ContactsSection c={c} />
    </div>
  );
}
