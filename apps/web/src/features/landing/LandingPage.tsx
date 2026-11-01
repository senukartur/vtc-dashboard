import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApplicationForm } from "../admissions/ApplicationForm.js";
import { useEventQuery } from "../events/queries.js";
import {
  ConvoyChip,
  ConvoySection,
  MotionToggle,
  publicConvoysPath,
  RouteTicker,
} from "./convoys.js";
import { LandingContent } from "./LandingContent.js";
import { StatsBand } from "./StatsBand.js";

export function LandingPage() {
  const { i18n } = useTranslation(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    query = useEventQuery(publicConvoysPath, "EnvelopeListEventPublic"),
    [paused, setPaused] = useState(false),
    refreshed = useRef(new Set<string>()),
    items = query.data?.data.data.items,
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
      heroChip={
        <ConvoyChip
          items={items}
          pending={query.isPending}
          paused={paused}
          locale={locale}
          onPassed={onPassed}
        />
      }
      heroControls={
        <MotionToggle
          paused={paused}
          hasScheduled={hasScheduled}
          locale={locale}
          onToggle={() => setPaused((value) => !value)}
        />
      }
      ticker={items && <RouteTicker items={items} />}
      stats={<StatsBand locale={locale} />}
      events={<ConvoySection query={query} locale={locale} />}
      application={<ApplicationForm />}
      interactive
    />
  );
}
