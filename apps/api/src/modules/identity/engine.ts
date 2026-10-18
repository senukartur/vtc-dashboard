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

declare const credentialProofBrand: unique symbol;
export type CredentialProof = { readonly [credentialProofBrand]: true };
export interface SignInBinding {
  userId: string;
  credentialId: string;
  email: string;
  emailVerified: boolean;
  accessEpoch: number;
  identityEpoch: number;
  credentialEpoch: number;
  emailEpoch: number;
  companyVersion: number;
}
const credentialProofs = new WeakMap<
  CredentialProof,
  { hash: string; password: string; binding: SignInBinding; config: IdentityConfig }
>();

// This capability can only be minted by the pinned native verifier. Neither a
// caller-supplied boolean nor an object with the same shape can skip verification.
export async function verifySignInCredential(
  hash: string | null,
  password: string,
  config: IdentityConfig,
  binding?: SignInBinding,
): Promise<CredentialProof | null> {
  if (!hash) {
    // Match the pinned native endpoint's dummy work for an absent credential.
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword({ hash, password }))) return null;
  if (!binding) throw new Error("MISSING_INTERNAL_CREDENTIAL_BINDING");
  const proof = Object.freeze({}) as CredentialProof;
  credentialProofs.set(proof, { hash, password, binding: { ...binding }, config: { ...config } });
  return proof;
}

export function engine(
  client: TransactionClient,
  config: IdentityConfig,
  proof?: CredentialProof,
  binding?: SignInBinding,
) {
  const verified = proof ? credentialProofs.get(proof) : undefined;
  if (
    proof &&
    (!verified ||
      !binding ||
      Object.entries(verified.binding).some(
        ([key, value]) => binding[key as keyof SignInBinding] !== value,
      ) ||
      Object.entries(verified.config).some(
        ([key, value]) => config[key as keyof IdentityConfig] !== value,
      ))
  )
    throw new Error("INVALID_INTERNAL_CREDENTIAL_PROOF");
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
    databaseHooks: verified
      ? {
          session: {
            create: {
              before: async (session) => {
                if (session.userId !== verified.binding.userId)
                  throw Object.assign(new Error("STALE_INTERNAL_CREDENTIAL_PROOF"), {
                    statusCode: 401,
                  });
                return { data: session };
              },
            },
          },
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: async (password: string): Promise<string> => {
          // Missing/changed native credential data must not restart expensive
          // dummy work inside the final transaction or accept a stale proof.
          if (verified)
            throw Object.assign(new Error("STALE_INTERNAL_CREDENTIAL_PROOF"), { statusCode: 401 });
          return hashPassword(password);
        },
        verify: async (input: { hash: string; password: string }): Promise<boolean> =>
          verified
            ? input.hash === verified.hash && input.password === verified.password
            : verifyPassword(input),
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
