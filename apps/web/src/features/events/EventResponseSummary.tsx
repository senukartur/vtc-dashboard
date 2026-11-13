import { useTranslation } from "react-i18next";
import { eventListCopy } from "./event-list-copy.js";
import { useEventListLocale } from "./event-list-queries.js";
import { type ResponseValue, responseChoiceKey, responseTone } from "./view-model.js";
import "./event-list.css";

export function EventResponseSummary({ response }: { response: ResponseValue | null }) {
  const { t } = useTranslation("events");
  const locale = useEventListLocale();
  if (response === null) return <span>{eventListCopy[locale].responseUnavailable}</span>;
  const { tone, symbol } = responseTone(response);
  return (
    <span className={`event-response-summary event-response-${tone}`}>
      <span aria-hidden="true">{symbol}</span> {t("response")}: {t(responseChoiceKey(response))}
    </span>
  );
}
