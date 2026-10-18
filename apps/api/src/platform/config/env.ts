import { resolve } from "node:path";
import { z } from "zod";
import { validateIdentityConfig } from "../../modules/identity/engine.js";

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
  return {
    environment: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    serveWeb: env.SERVE_WEB === "true",
    webRoot: resolve(env.WEB_ROOT),
    identity,
    database: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
    },
  };
}
