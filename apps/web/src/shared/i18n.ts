import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { accountTranslations } from "../features/account/translations.js";
import { admissionsTranslations } from "../features/admissions/translations.js";
import { catalogTranslations } from "../features/catalogs/translations.js";
import { foundationTranslations } from "../features/foundation/translations.js";
import { core } from "../i18n/core/resources.js";

await i18next.use(initReactI18next).init({
  lng: typeof window !== "undefined" && window.location.pathname === "/en" ? "en" : "ru",
  fallbackLng: "en",
  supportedLngs: ["ru", "en"],
  defaultNS: "core",
  interpolation: { escapeValue: false },
  resources: {
    en: {
      core: core.en,
      foundation: foundationTranslations.en,
      admissions: admissionsTranslations.en,
      account: accountTranslations.en,
      catalogs: catalogTranslations.en,
    },
    ru: {
      core: core.ru,
      foundation: foundationTranslations.ru,
      admissions: admissionsTranslations.ru,
      account: accountTranslations.ru,
      catalogs: catalogTranslations.ru,
    },
  },
});

export default i18next;
