export type PublicLocale = "ru" | "en";
export const publicContent = {
  ru: {
    title: "Yukon Union — виртуальная транспортная компания ETS2 и ATS",
    description:
      "Yukon Union: рейсы в ETS2 и ATS, развитие в каждой игре и добровольные конвои. Узнайте о компании и подайте заявку на вступление.",
    eyebrow: "Виртуальная транспортная компания · ETS2 / ATS",
    heading: "Своя компания. Общая дорога.",
    intro:
      "Yukon Union объединяет водителей Euro Truck Simulator 2 и American Truck Simulator. Ездим, развиваемся и встречаемся на совместных маршрутах.",
    apply: "Подать заявку",
    events: "Публичные события",
    login: "Войти",
    about: "О компании",
    requirements: "Как вступить",
    contacts: "Контакты",
    aboutTitle: "Каждый рейс — часть общего пути",
    values: [
      {
        title: "Две игры, свой прогресс",
        text: "Квалификация и развитие в ETS2 и ATS учитываются независимо. Можно выбрать одну игру или обе.",
      },
      {
        title: "Рейсы с подтверждением",
        text: "Телеметрия или ручной отчёт с проверкой сотрудником помогают сохранить историю ваших поездок.",
      },
      {
        title: "Вместе, когда удобно",
        text: "Участие в конвоях добровольное. Общая дорога начинается с желания ехать вместе.",
      },
    ],
    requirementsTitle: "Начните со знакомства",
    requirementsText:
      "Для заявки нужны никнейм, email для приглашения, ссылка на профиль Steam и хотя бы одна игра — ETS2 или ATS. Discord и рассказ о себе необязательны.",
    review:
      "Заявку рассмотрит руководство компании. После одобрения вы сможете получить одноразовое приглашение для создания пароля, действующее семь дней. Отправка заявки не означает принятия в компанию.",
    contactsTitle: "Остаёмся на связи",
    contactsText: "Наши публичные сообщества и страницы компании.",
    contactPage: "Страница контактов",
    noScript:
      "Для отправки заявки включите JavaScript. Связаться с компанией можно по ссылкам ниже.",
    eventsTitle: "Публичные события ещё готовятся",
    eventsText:
      "Публикация конвоев появится позже. Списки участников и причины отказа не публикуются для гостей.",
    loginTitle: "Вход в кабинет ещё готовится",
    loginText:
      "Экран входа и работа с приглашением появятся позже. Здесь можно познакомиться с компанией и подать заявку.",
  },
  en: {
    title: "Yukon Union — ETS2 and ATS virtual trucking company",
    description:
      "Yukon Union: ETS2 and ATS trips, independent progression in each game and voluntary convoys. Learn about the company and apply to join.",
    eyebrow: "Virtual trucking company · ETS2 / ATS",
    heading: "Your company. Our road.",
    intro:
      "Yukon Union brings together Euro Truck Simulator 2 and American Truck Simulator drivers. Drive, progress and meet on shared routes.",
    apply: "Apply to join",
    events: "Public events",
    login: "Sign in",
    about: "About us",
    requirements: "How to join",
    contacts: "Contacts",
    aboutTitle: "Every trip is part of the journey",
    values: [
      {
        title: "Two games, your own progress",
        text: "Qualification and progression are independent in ETS2 and ATS. Choose one game or both.",
      },
      {
        title: "Trips with evidence",
        text: "Telemetry or a manual report reviewed by staff helps preserve the history of your trips.",
      },
      {
        title: "Together, when it suits you",
        text: "Convoy participation is voluntary. A shared road begins with wanting to drive together.",
      },
    ],
    requirementsTitle: "Start with an introduction",
    requirementsText:
      "Your application needs a nickname, an invitation email, a Steam profile link and at least one game — ETS2 or ATS. Discord and an introduction are optional.",
    review:
      "Company leadership reviews applications. After approval, you can receive a one-time invitation to set a password, valid for seven days. Submitting an application does not mean acceptance into the company.",
    contactsTitle: "Stay in touch",
    contactsText: "Our public communities and company pages.",
    contactPage: "Contact page",
    noScript:
      "Enable JavaScript to submit an application. You can contact the company using the links below.",
    eventsTitle: "Public events are on the way",
    eventsText:
      "Convoy publishing will arrive later. Participant lists and decline reasons are not public for visitors.",
    loginTitle: "Member sign-in is on the way",
    loginText:
      "Sign-in and invitation screens will arrive later. You can learn about the company and apply here.",
  },
} as const;
export const publicContacts = [
  { label: "TruckersMP", href: "https://truckersmp.com/vtc/190" },
  { label: "Steam", href: "http://steamcommunity.com/groups/yukon_union" },
  { label: "VK", href: "https://vk.com/yukon_union_2" },
  { label: "Discord", href: "https://discord.com/invite/fBXecKW" },
  { label: "VTC.World", href: "https://forum.vtc.world/index.php?/clubs/7-yukon-union/" },
];
export function publicPath(locale: PublicLocale) {
  return locale === "en" ? "/en" : "/";
}
