export const admissionsTranslations = {
  ru: {
    title: "Заявка на вступление",
    nickname: "Никнейм",
    email: "Email для приглашения",
    steamProfileUrl: "Ссылка на профиль Steam",
    discord: "Discord (необязательно)",
    introduction: "О себе (необязательно)",
    games: "Ваши игры",
    required: "Обязательные поля: никнейм, email, Steam и хотя бы одна игра.",
    steamHelp:
      "https://steamcommunity.com/id/имя или /profiles/17 цифр. Без параметров и фрагментов.",
    privacy:
      "Данные заявки доступны только уполномоченному руководству для рассмотрения и приглашения. Они не публикуются на сайте.",
    submit: "Отправить заявку",
    pending: "Отправляем…",
    retry: "Повторить отправку",
    success:
      "Отправка подтверждена. Если заявка может быть принята к рассмотрению, руководство рассмотрит её. Это не подтверждение членства или доставки письма.",
    errors: {
      nickname: "Введите никнейм: от 1 до 128 символов.",
      email: "Введите корректный email, не длиннее 254 символов.",
      steamProfileUrl:
        "Укажите HTTPS-ссылку steamcommunity.com/id/имя или /profiles/17 цифр (до 512 символов).",
      games: "Выберите ETS2, ATS или обе игры.",
      discord: "Discord: не более 256 символов.",
      introduction: "Рассказ о себе: не более 4000 символов.",
      invalid: "Проверьте поля: сервер не принял данные. Введённое сохранено.",
      forbidden: "Проверка безопасности не пройдена. Повторите отправку; данные сохранены.",
      conflict: "Сервер не смог подтвердить эту отправку. Проверьте данные и повторите позже.",
      limited: "Слишком много запросов. Подождите перед повторной отправкой.",
      unavailable: "Приём заявок сейчас недоступен. Введённое сохранено; повторите позже.",
      uncertain:
        "Не удалось подтвердить отправку. Повторите с теми же данными, чтобы безопасно проверить результат.",
      summary: "Исправьте отмеченные поля.",
      wait: "Повторная отправка через {{seconds}} с.",
      changed:
        "Изменённые данные будут отправлены как новая заявка. Предыдущая отправка могла сохраниться.",
    },
  },
  en: {
    title: "Membership application",
    nickname: "Nickname",
    email: "Invitation email",
    steamProfileUrl: "Steam profile link",
    discord: "Discord (optional)",
    introduction: "Introduction (optional)",
    games: "Your games",
    required: "Required: nickname, email, Steam and at least one game.",
    steamHelp: "https://steamcommunity.com/id/name or /profiles/17 digits. No query or fragment.",
    privacy:
      "Only authorized company leadership can access your application for review and invitation. It is not published on the site.",
    submit: "Send application",
    pending: "Sending…",
    retry: "Retry submission",
    success:
      "Submission acknowledged. If the application is eligible for review, company leadership will review it. This does not confirm membership or email delivery.",
    errors: {
      nickname: "Enter a nickname between 1 and 128 characters.",
      email: "Enter a valid email, up to 254 characters.",
      steamProfileUrl:
        "Use an HTTPS steamcommunity.com/id/name or /profiles/17 digits link (up to 512 characters).",
      games: "Select ETS2, ATS or both games.",
      discord: "Discord must be at most 256 characters.",
      introduction: "Introduction must be at most 4000 characters.",
      invalid: "Check the fields: the server did not accept the data. Your input is preserved.",
      forbidden: "The security check failed. Retry submission; your input is preserved.",
      conflict: "The server could not confirm this submission. Check the data and try again later.",
      limited: "Too many requests. Wait before submitting again.",
      unavailable:
        "Applications are currently unavailable. Your input is preserved; try again later.",
      uncertain:
        "Submission could not be confirmed. Retry with the same details to safely check the result.",
      summary: "Correct the marked fields.",
      wait: "You can retry in {{seconds}} seconds.",
      changed:
        "Changed details will be sent as a new application. The previous submission may have been saved.",
    },
  },
} as const;
