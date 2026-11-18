import { Check, CircleHelp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { eventListCopy } from "./event-list-copy.js";
import { useEventListLocale } from "./event-list-queries.js";
import { type ResponseValue, responseChoiceKey, responseTone } from "./view-model.js";
import "./event-list.css";

export function EventResponseSummary({ response }: { response: ResponseValue | null }) {
  const { t } = useTranslation("events");
  const locale = useEventListLocale();
  if (response === null) return <span>{eventListCopy[locale].responseUnavailable}</span>;
  const { tone } = responseTone(response);
  return (
    <span className={`event-response-summary event-response-${tone}`}>
      <ResponseIcon response={response} /> {t("response")}: {t(responseChoiceKey(response))}
    </span>
  );
}

export function ResponseIcon({ response }: { response: ResponseValue }) {
  const Icon = { check: Check, x: X, "circle-help": CircleHelp }[responseTone(response).icon];
  return <Icon size={14} strokeWidth={1.8} aria-hidden="true" />;
}
