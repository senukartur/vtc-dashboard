import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { applicationId, utcDateTime, utcIso } from "@vtc/db";
import { closed } from "../../platform/outbox/events.js";

export const kinds = [
  "email_verification",
  "password_reset",
  "password_change",
  "email_change",
  "succession",
  "invitation",
  "rejection",
] as const;
export type Kind = (typeof kinds)[number];
export type Locale = "en" | "ru";
export interface MailIntent {
  owner: "identity" | "admissions";
  generationId: string;
  userId: string | null;
  kind: Kind;
  locale: Locale;
  recipient: string;
  expiresAt: string;
  code?: string;
  link?: string;
  reason?: string;
  stage?: "current_email" | "proposed_email";
}
export interface MailRequest {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}
export interface PrivateMail {
  intent: MailIntent;
  request: MailRequest;
  providerBinding: string;
}
export function mailbox(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(
      value,
    )
  )
    throw new Error("INVALID_MAIL_ADDRESS");
  return value;
}
function bounded(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    ![...value].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    }) &&
    !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)
  );
}
export function validateIntent(value: MailIntent, origin: string): MailIntent {
  closed(
    value,
    [
      "owner",
      "generationId",
      "userId",
      "kind",
      "locale",
      "recipient",
      "expiresAt",
      "code",
      "link",
      "reason",
      "stage",
    ].filter((key) => Object.hasOwn(value, key)),
  );
  if (
    !["identity", "admissions"].includes(value.owner) ||
    !kinds.includes(value.kind) ||
    !["en", "ru"].includes(value.locale)
  )
    throw new Error("INVALID_MAIL_INTENT");
  applicationId(value.generationId);
  if (value.userId !== null) applicationId(value.userId);
  mailbox(value.recipient);
  const expiresAt = utcIso(utcDateTime(value.expiresAt));
  if (value.owner === "identity") {
    if (
      !value.userId ||
      ["invitation", "rejection"].includes(value.kind) ||
      !bounded(value.code, 256) ||
      /\s/.test(value.code) ||
      value.link !== undefined ||
      value.reason !== undefined ||
      (value.kind === "email_change"
        ? !["current_email", "proposed_email"].includes(value.stage ?? "")
        : value.stage !== undefined)
    )
      throw new Error("INVALID_MAIL_INTENT");
  } else {
    if (
      value.userId !== null ||
      !["invitation", "rejection"].includes(value.kind) ||
      value.code !== undefined ||
      value.stage !== undefined
    )
      throw new Error("INVALID_MAIL_INTENT");
    if (value.kind === "rejection") {
      if (!bounded(value.reason, 8000) || value.link !== undefined)
        throw new Error("INVALID_MAIL_INTENT");
    } else {
      if (!bounded(value.link, 2048) || value.reason !== undefined)
        throw new Error("INVALID_MAIL_INTENT");
      const url = new URL(value.link);
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.pathname !== "/invitation" ||
        !url.searchParams.has("token") ||
        url.hash
      )
        throw new Error("INVALID_MAIL_LINK");
    }
  }
  return { ...value, expiresAt };
}
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const subjects: Record<Locale, Record<Kind, string>> = {
  en: {
    email_verification: "Verify your email",
    password_reset: "Reset your password",
    password_change: "Confirm password change",
    email_change: "Confirm email change",
    succession: "Confirm leadership transfer",
    invitation: "Invitation to the company",
    rejection: "Your membership application",
  },
  ru: {
    email_verification: "Подтверждение электронной почты",
    password_reset: "Сброс пароля",
    password_change: "Подтверждение смены пароля",
    email_change: "Подтверждение смены почты",
    succession: "Подтверждение передачи руководства",
    invitation: "Приглашение в компанию",
    rejection: "Ваша заявка в компанию",
  },
};
export function render(intent: MailIntent, sender: string, origin: string): MailRequest {
  const ru = intent.locale === "ru";
  const subject = subjects[intent.locale][intent.kind];
  let detail: string;
  let link = intent.link;
  if (intent.kind === "password_reset")
    link = `${origin}/password-reset?token=${encodeURIComponent(intent.code ?? "")}`;
  if (intent.kind === "rejection")
    detail = `${ru ? "Причина отказа" : "Reason for rejection"}:\n${intent.reason}`;
  else if (link) detail = `${ru ? "Откройте ссылку" : "Open this link"}:\n${link}`;
  else
    detail = `${ru ? "Одноразовый код" : "One-time code"}: ${intent.code}${intent.stage ? `\n${ru ? "Этап" : "Stage"}: ${intent.stage === "current_email" ? (ru ? "текущая почта" : "current email") : ru ? "новая почта" : "proposed email"}` : ""}`;
  const text = `${subject}\n\n${detail}\n\n${ru ? "Действует до" : "Valid until"}: ${intent.expiresAt} (UTC).\n${ru ? "Если вы не запрашивали это действие, проигнорируйте письмо." : "If you did not request this action, ignore this email."}`;
  return {
    from: mailbox(sender),
    to: [mailbox(intent.recipient)],
    subject,
    text,
    html: `<div lang="${intent.locale}"><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(detail).replaceAll("\n", "<br>")}</p><p>${escapeHtml(ru ? "Действует до" : "Valid until")}: ${escapeHtml(intent.expiresAt)} (UTC).</p><p>${escapeHtml(ru ? "Если вы не запрашивали это действие, проигнорируйте письмо." : "If you did not request this action, ignore this email.")}</p></div>`,
  };
}
export function mailCrypto(encoded: string) {
  if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error("INVALID_MAIL_KEY");
  const key = Buffer.from(encoded, "hex");
  const fingerprintKey = createHmac("sha256", key).update("mail-input-fingerprint-v1").digest();
  return {
    binding(value: string) {
      return createHmac("sha256", fingerprintKey).update(`provider:${value}`).digest("hex");
    },
    fingerprint(value: MailIntent) {
      return createHmac("sha256", fingerprintKey)
        .update(
          JSON.stringify(
            Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
          ),
        )
        .digest();
    },
    seal(id: string, value: PrivateMail): string {
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(`vtc:mail:v1:${applicationId(id)}`));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
    },
    open(id: string, encodedValue: string): PrivateMail {
      try {
        if (encodedValue.length > 200000) throw new Error();
        const bytes = Buffer.from(encodedValue, "base64"),
          decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(`vtc:mail:v1:${applicationId(id)}`));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(
          Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
        ) as PrivateMail;
      } catch {
        throw new Error("MAIL_CIPHERTEXT_UNAVAILABLE");
      }
    },
  };
}
