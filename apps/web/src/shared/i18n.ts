import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { accountTranslations } from "../features/account/translations.js";
import { admissionsTranslations } from "../features/admissions/translations.js";
import { catalogTranslations } from "../features/catalogs/translations.js";
import { dashboardTranslations } from "../features/dashboard/translations.js";
import { driverTranslations } from "../features/drivers/translations.js";
import { foundationTranslations } from "../features/foundation/translations.js";
import { promotionTranslations } from "../features/qualifications/promotion-translations.js";
import { qualificationTranslations } from "../features/qualifications/translations.js";
import { tripTranslations } from "../features/trips/translations.js";
import { administrationTranslations } from "../features/admin/translations.js";
import { core } from "../i18n/core/resources.js";
import { eventTranslations } from "../features/events/translations.js";
import { notificationTranslations } from "../features/notifications/translations.js";

export const localeStorageKey = "vtc.locale";

export function readStoredLocale(): "ru" | "en" | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const value = window.localStorage.getItem(localeStorageKey);
    return value === "ru" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: "ru" | "en"): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(localeStorageKey, locale);
    }
  } catch {
    // Storage can be restricted or unavailable (e.g. private mode, quota exceeded)
  }
}

export function resolveInitialLocale(): "ru" | "en" {
  if (typeof window === "undefined") return "ru";
  if (window.location.pathname === "/en") return "en";
  if (
    window.location.pathname.startsWith("/account") ||
    window.location.pathname.replace(/\/$/, "") === "/login"
  ) {
    return readStoredLocale() ?? "ru";
  }
  return "ru";
}

await i18next.use(initReactI18next).init({
  lng: resolveInitialLocale(),
  fallbackLng: "en",
  supportedLngs: ["ru", "en"],
  defaultNS: "core",
  interpolation: { escapeValue: false },
  resources: {
    en: {
      notifications: notificationTranslations.en,
      events: eventTranslations.en,
      core: core.en,
      administration: administrationTranslations.en,
      foundation: foundationTranslations.en,
      admissions: admissionsTranslations.en,
      account: accountTranslations.en,
      catalogs: catalogTranslations.en,
      trips: tripTranslations.en,
      qualifications: qualificationTranslations.en,
      promotions: promotionTranslations.en,
      dashboard: dashboardTranslations.en,
      drivers: driverTranslations.en,
    },
    ru: {
      notifications: notificationTranslations.ru,
      events: eventTranslations.ru,
      core: core.ru,
      administration: administrationTranslations.ru,
      foundation: foundationTranslations.ru,
      admissions: admissionsTranslations.ru,
      account: accountTranslations.ru,
      catalogs: catalogTranslations.ru,
      trips: tripTranslations.ru,
      qualifications: qualificationTranslations.ru,
      promotions: promotionTranslations.ru,
      dashboard: dashboardTranslations.ru,
      drivers: driverTranslations.ru,
    },
  },
});

export default i18next;
