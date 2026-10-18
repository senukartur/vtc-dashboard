import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { TransactionClient } from "@vtc/db";
import { authSchema } from "@vtc/db/identity-schema";
import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";

export interface IdentityConfig {
  secret: string;
  origin: string;
  production: boolean;
}

export function validateIdentityConfig(config: IdentityConfig): void {
  const origin = new URL(config.origin);
  if (
    config.secret.length < 32 ||
    config.secret.startsWith("REPLACE_") ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== config.origin ||
    (config.production && origin.protocol !== "https:") ||
    origin.username ||
    origin.password
  )
    throw new Error("INVALID_IDENTITY_CONFIGURATION");
}

export async function prepareCredential(password: string): Promise<{ passwordHash: string }> {
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    throw Object.assign(new Error("INVALID_PASSWORD_POLICY"), { statusCode: 422 });
  return { passwordHash: await hashPassword(password) };
}

export function engine(client: TransactionClient, config: IdentityConfig) {
  // Adapter 1.7.10 uses transaction() for MySQL's post-write SELECT. Join the
  // caller's already active transaction: this bridge never starts/commits DML.
  const joined = new Proxy(client, {
    get(target, key, receiver) {
      if (key === "transaction")
        return <T>(callback: (db: TransactionClient) => Promise<T>) => callback(client);
      return Reflect.get(target, key, receiver);
    },
  });
  return betterAuth({
    secret: config.secret,
    baseURL: config.origin,
    basePath: "/private-auth-engine",
    database: drizzleAdapter(joined, { provider: "mysql", schema: authSchema, transaction: false }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: async (password: string): Promise<string> => hashPassword(password),
        verify: async (input: { hash: string; password: string }): Promise<boolean> =>
          verifyPassword(input),
      },
    },
    session: {
      expiresIn: 86400,
      updateAge: 86400,
      cookieCache: { enabled: false },
      additionalFields: {
        accessEpoch: { type: "number", defaultValue: 0, input: false },
        credentialEpoch: { type: "number", defaultValue: 0, input: false },
      },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      // 1.7.10 prefixes even custom cookie names with __Secure-. Configure
      // explicit secure attributes to preserve the stronger exact __Host- name.
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        session_token: {
          name: config.production ? "__Host-vtc_session" : "vtc_dev_session",
          attributes: { httpOnly: true, secure: config.production, sameSite: "lax", path: "/" },
        },
      },
      ipAddress: { disableIpTracking: true },
    },
    trustedOrigins: [config.origin],
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}
