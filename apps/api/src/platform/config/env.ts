import { resolve } from "node:path";
import { z } from "zod";
import { type AdmissionsConfig, admissionsSecurity } from "../../modules/admissions/security.js";
import { validateIdentityConfig } from "../../modules/identity/engine.js";
import { type MessagingConfig, validateMessagingConfig } from "../../modules/messaging/service.js";
import { exactProxyAddress } from "../http/ingress.js";

const port = z.coerce.number().int().min(1).max(65535);
const settings = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: port.default(3000),
  SERVE_WEB: z.enum(["true", "false"]).default("false"),
  WEB_ROOT: z.string().min(1).default("apps/web/dist"),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: port,
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z
    .string()
    .min(16)
    .refine((value) => !value.startsWith("REPLACE_")),
});

export function readConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = settings.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment fields: ${fields.join(", ")}`);
  }
  const env = parsed.data;
  let proxyAddress: string | undefined;
  if (input.API_TRUSTED_PROXY_IPV4 !== undefined) {
    try {
      proxyAddress = exactProxyAddress(input.API_TRUSTED_PROXY_IPV4);
    } catch {
      throw new Error("Invalid environment fields: API_TRUSTED_PROXY_IPV4");
    }
  }
  const enabled = input.IDENTITY_ENABLED === "true";
  if (input.IDENTITY_ENABLED !== undefined && !["true", "false"].includes(input.IDENTITY_ENABLED))
    throw new Error("Invalid environment fields: IDENTITY_ENABLED");
  const identity = enabled
    ? {
        secret: input.IDENTITY_SECRET ?? "",
        origin: input.IDENTITY_ORIGIN ?? "",
        production: env.NODE_ENV === "production",
      }
    : undefined;
  if (identity) {
    try {
      validateIdentityConfig(identity);
    } catch {
      throw new Error("Invalid environment fields: IDENTITY_SECRET, IDENTITY_ORIGIN");
    }
  }
  const mode = input.MAIL_MODE ?? "disabled";
  if (!["disabled", "local", "resend"].includes(mode))
    throw new Error("Invalid environment fields: MAIL_MODE");
  let mail: (MessagingConfig & { apiKey?: string }) | undefined;
  if (mode !== "disabled") {
    try {
      if (
        !identity ||
        (mode === "resend" &&
          (input.MAIL_TRACKING_DISABLED !== "true" ||
            !input.MAIL_API_KEY ||
            input.MAIL_API_KEY.startsWith("REPLACE_") ||
            /\s/.test(input.MAIL_API_KEY)))
      )
        throw new Error();
      mail = {
        mode: mode as "local" | "resend",
        key: input.MAIL_ENCRYPTION_KEY ?? "",
        sender: input.MAIL_SENDER ?? "",
        origin: identity.origin,
        production: env.NODE_ENV === "production",
        ...(mode === "resend" ? { apiKey: input.MAIL_API_KEY ?? "" } : {}),
      };
      validateMessagingConfig(mail);
    } catch {
      throw new Error(
        "Invalid environment fields: MAIL_MODE, MAIL_ENCRYPTION_KEY, MAIL_SENDER, MAIL_API_KEY, MAIL_TRACKING_DISABLED, IDENTITY_ENABLED",
      );
    }
  }
  let admissions: AdmissionsConfig | undefined;
  if (
    input.ADMISSIONS_ENABLED !== undefined &&
    !["true", "false"].includes(input.ADMISSIONS_ENABLED)
  )
    throw new Error("Invalid environment fields: ADMISSIONS_ENABLED");
  if (input.ADMISSIONS_ENABLED === "true") {
    try {
      if (!identity) throw new Error();
      admissions = { key: input.ADMISSIONS_ENCRYPTION_KEY ?? "", origin: identity.origin };
      admissionsSecurity(admissions);
      if (
        admissions.key === input.MAIL_ENCRYPTION_KEY ||
        admissions.key === identity.secret ||
        Buffer.from(admissions.key, "base64url").equals(Buffer.from(identity.secret, "hex")) ||
        Buffer.from(admissions.key, "base64url").equals(
          Buffer.from(input.MAIL_ENCRYPTION_KEY ?? "", "hex"),
        )
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid environment fields: ADMISSIONS_ENABLED, ADMISSIONS_ENCRYPTION_KEY, IDENTITY_ENABLED",
      );
    }
  }
  return {
    environment: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    serveWeb: env.SERVE_WEB === "true",
    webRoot: resolve(env.WEB_ROOT),
    proxyAddress,
    identity,
    mail,
    admissions,
    database: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
    },
  };
}
