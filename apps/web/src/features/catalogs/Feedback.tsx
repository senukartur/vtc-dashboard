import { useTranslation } from "react-i18next";
import type { AccountFailure } from "../account/transport.js";
export function Failure({
  error,
  seconds = 0,
}: {
  error: AccountFailure | null;
  seconds?: number;
}) {
  const { t } = useTranslation("catalogs");
  return error ? (
    <div role="alert" className="field-error">
      <p>{t(error.kind === "unavailable" ? "unavailableError" : error.kind)}</p>
      {seconds > 0 && <p>{t("wait", { seconds })}</p>}
    </div>
  ) : null;
}
