import { useTranslation } from "react-i18next";
import { formatUtc, type Locale } from "../../shared/formatting.js";

export interface CatalogRowFormat {
  locale: Locale;
  timezone: string;
}

export function CatalogUpdatedAt({
  value,
  locale,
  timezone,
}: CatalogRowFormat & { value: string | undefined }) {
  return value ? (
    <time dateTime={value}>{formatUtc(value, locale, timezone)}</time>
  ) : (
    <MissingMetadata />
  );
}

export function MissingMetadata() {
  const { t } = useTranslation("catalogs");
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{t("metadataUnavailable")}</span>
    </>
  );
}
