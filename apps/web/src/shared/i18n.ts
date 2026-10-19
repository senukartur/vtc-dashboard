import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { foundationTranslations } from "../features/foundation/translations.js";
import { core } from "../i18n/core/resources.js";

await i18next.use(initReactI18next).init({
  lng: "ru",
  fallbackLng: "en",
  supportedLngs: ["ru", "en"],
  defaultNS: "core",
  interpolation: { escapeValue: false },
  resources: {
    en: { core: core.en, foundation: foundationTranslations.en },
    ru: { core: core.ru, foundation: foundationTranslations.ru },
  },
});

export default i18next;
