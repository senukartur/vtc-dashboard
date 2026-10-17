import i18next from "i18next";
import { initReactI18next } from "react-i18next";

await i18next.use(initReactI18next).init({
  lng: "ru",
  fallbackLng: "en",
  supportedLngs: ["ru", "en"],
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        language: "Language",
        heading: "VTC Dashboard",
        stage: "Development workspace",
        description:
          "The foundation is ready for the next project stages. Company features will be added separately.",
        checking: "Checking connection…",
        ready: "Application and database are connected",
        unavailable: "Database is not ready",
        failed: "Could not reach the application",
        retry: "Check again",
        notFound: "This page does not exist yet",
        home: "Home",
      },
    },
    ru: {
      translation: {
        language: "Язык",
        heading: "VTC Dashboard",
        stage: "Среда разработки",
        description:
          "Основа для следующих этапов проекта. Функции компании будут добавляться отдельно.",
        checking: "Проверяем подключение…",
        ready: "Приложение и база данных подключены",
        unavailable: "База данных пока недоступна",
        failed: "Не удалось связаться с приложением",
        retry: "Проверить снова",
        notFound: "Этой страницы пока нет",
        home: "На главную",
      },
    },
  },
});

export default i18next;
