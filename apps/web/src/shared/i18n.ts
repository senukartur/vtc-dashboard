import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { accountTranslations } from "../features/account/translations.js";
import { admissionsTranslations } from "../features/admissions/translations.js";
import { catalogTranslations } from "../features/catalogs/translations.js";
import { dashboardTranslations } from "../features/dashboard/translations.js";
import { driverTranslations } from "../features/drivers/translations.js";
import { foundationTranslations } from "../features/foundation/translations.js";
import { qualificationTranslations } from "../features/qualifications/translations.js";
import { tripTranslations } from "../features/trips/translations.js";
import { administrationTranslations } from "../features/admin/translations.js";
import { core } from "../i18n/core/resources.js";
import { eventTranslations } from "../features/events/translations.js";

await i18next.use(initReactI18next).init({
  lng: typeof window !== "undefined" && window.location.pathname === "/en" ? "en" : "ru",
  fallbackLng: "en",
  supportedLngs: ["ru", "en"],
  defaultNS: "core",
  interpolation: { escapeValue: false },
  resources: {
    en: {
      events: eventTranslations.en,
      core: core.en,
      administration: administrationTranslations.en,
      foundation: foundationTranslations.en,
      admissions: admissionsTranslations.en,
      account: accountTranslations.en,
      catalogs: catalogTranslations.en,
      trips: tripTranslations.en,
      qualifications: qualificationTranslations.en,
      dashboard: dashboardTranslations.en,
      drivers: driverTranslations.en,
    },
    ru: {
      events: eventTranslations.ru,
      core: core.ru,
      administration: administrationTranslations.ru,
      foundation: foundationTranslations.ru,
      admissions: admissionsTranslations.ru,
      account: accountTranslations.ru,
      catalogs: catalogTranslations.ru,
      trips: tripTranslations.ru,
      qualifications: qualificationTranslations.ru,
      dashboard: dashboardTranslations.ru,
      drivers: driverTranslations.ru,
    },
  },
});

export default i18next;
