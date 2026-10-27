import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "../../shared/ui/primitives.js";
import { ApplicationForm } from "../admissions/ApplicationForm.js";
import { publicContent, publicPath } from "./content.js";
import { LandingContent } from "./LandingContent.js";
import { PublicEventWidget } from "../events/EventsPage.js";
export function LandingPage() {
  const { i18n } = useTranslation();
  return (
    <LandingContent
      locale={i18n.resolvedLanguage === "en" ? "en" : "ru"}
      application={<ApplicationForm />}
      events={<PublicEventWidget />}
      interactive
    />
  );
}
export function PublicBoundaryPage({ kind }: { kind: "events" | "login" }) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const c = publicContent[locale];
  return (
    <Card className="readiness-card">
      <h1>{c[kind === "events" ? "eventsTitle" : "loginTitle"]}</h1>
      <p className="lead">{c[kind === "events" ? "eventsText" : "loginText"]}</p>
      <Link className="button button-primary" to={`${publicPath(locale)}#apply`}>
        {c.apply}
      </Link>
    </Card>
  );
}
