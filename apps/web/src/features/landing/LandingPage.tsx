import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApplicationForm } from "../admissions/ApplicationForm.js";
import { useConvoyQuery } from "./convoy-query.js";
import { ConvoyChip, ConvoySection, MotionToggle } from "./convoys.js";
import { HeroVideo } from "./HeroVideo.js";
import { LandingContent } from "./LandingContent.js";
import { StatsBand } from "./StatsBand.js";

export function LandingPage() {
  const { i18n } = useTranslation(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    query = useConvoyQuery(locale),
    [paused, setPaused] = useState(false),
    refreshed = useRef(new Set<string>()),
    items = query.data,
    hasScheduled = !!items?.some((event) => event.status === "scheduled"),
    { refetch } = query;
  // A started convoy refreshes the shared list once, so the chip can move to the next one.
  const onPassed = useCallback(
    (id: string) => {
      if (refreshed.current.has(id)) return;
      refreshed.current.add(id);
      void refetch({ cancelRefetch: false });
    },
    [refetch],
  );
  return (
    <LandingContent
      locale={locale}
      motion={paused ? "paused" : "running"}
      heroChip={<ConvoyChip items={items} paused={paused} locale={locale} onPassed={onPassed} />}
      heroVideo={<HeroVideo paused={paused} />}
      heroControls={
        <MotionToggle
          paused={paused}
          hasScheduled={hasScheduled}
          locale={locale}
          onToggle={() => setPaused((value) => !value)}
        />
      }
      stats={<StatsBand locale={locale} />}
      events={<ConvoySection query={query} locale={locale} />}
      application={<ApplicationForm />}
      interactive
    />
  );
}
