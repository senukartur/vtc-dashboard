import { useTranslation } from "react-i18next";

/**
 * Explains a read that is still rate limited after its one automatic retry. `seconds`
 * comes from `rateLimitSeconds()`; null shows the generic one-minute wait.
 */
export function RateLimitNotice({ seconds }: { seconds: number | null }) {
  const { t } = useTranslation("core");
  return (
    <div role="status" className="notice">
      <strong>{t("rateLimit.title")}</strong>{" "}
      {seconds === null ? t("rateLimit.waitUnknown") : t("rateLimit.wait", { seconds })}
    </div>
  );
}
