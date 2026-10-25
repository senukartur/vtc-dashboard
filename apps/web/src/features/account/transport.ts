import { withReadSlot } from "../../shared/read-scheduler.js";
import type { components } from "@vtc/contracts";
import { z } from "zod";
import { csrfEnvelope, receiptEnvelope } from "../admissions/schema.js";
import { retryDelay } from "../admissions/transport.js";
export type DTO = components["schemas"];
const uuid = z.uuidv4();
const instant = z.iso.datetime({ precision: 3 });
const meta = z.strictObject({ requestId: z.string().min(1).max(128) });
const envelope = <T extends z.ZodType>(data: T) => z.strictObject({ data, meta });
const preferences = z.strictObject({
  locale: z.enum(["ru", "en"]),
  displayTimezone: z.string().min(1).max(128),
});
export const selfEnvelope = envelope(
  z.strictObject({
    member: z.strictObject({
      id: uuid,
      nickname: z.string().min(1).max(128),
      formerMember: z.boolean(),
      roles: z.array(z.enum(["trainee", "driver", "dispatcher", "deputy_director", "director"])),
    }),
    email: z.email(),
    emailVerified: z.boolean(),
    capabilities: z.array(z.string().min(1).max(128)),
    preferences,
    steamVerified: z.boolean(),
    identityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    missingSetup: z.array(z.string().min(1).max(128)),
  }),
);
const challengeEnvelope = envelope(
  z.strictObject({ id: uuid, expiresAt: instant, state: z.enum(["pending", "sent", "expired"]) }),
);
const pendingEnvelope = envelope(
  z.strictObject({
    pending: z
      .strictObject({
        id: uuid,
        proposedEmail: z.email().max(254),
        expiresAt: instant,
        stage: z.enum(["current_email", "proposed_email"]),
      })
      .nullable(),
  }),
);
const acknowledged = envelope(z.strictObject({ status: z.literal("received") }));
export const operations = {
  login: { path: "/auth/login", schema: selfEnvelope, status: 200, keyed: false },
  logout: { path: "/auth/logout", schema: receiptEnvelope, status: 200, keyed: false },
  recovery: {
    path: "/auth/password-reset-requests",
    schema: acknowledged,
    status: 202,
    keyed: true,
  },
  reset: { path: "/auth/password-resets", schema: receiptEnvelope, status: 200, keyed: true },
  invitation: {
    path: "/public/invitation-redemptions",
    schema: receiptEnvelope,
    status: 201,
    keyed: true,
  },
  preferences: { path: "/me/preferences", schema: envelope(preferences), status: 200, keyed: true },
  verifyRequest: {
    path: "/me/email-verification-requests",
    schema: challengeEnvelope,
    status: 202,
    keyed: true,
  },
  verify: { path: "/me/email-verifications", schema: receiptEnvelope, status: 200, keyed: true },
  challenge: {
    path: "/me/credential-challenges",
    schema: challengeEnvelope,
    status: 202,
    keyed: true,
  },
  password: { path: "/me/credential-changes", schema: receiptEnvelope, status: 200, keyed: true },
  emailCurrent: {
    path: "/me/credential-changes",
    schema: challengeEnvelope,
    status: 202,
    keyed: true,
  },
  emailProposed: {
    path: "/me/email-change-confirmations",
    schema: receiptEnvelope,
    status: 200,
    keyed: true,
  },
} as const;
export type Operation = keyof typeof operations;
export interface Inputs {
  login: DTO["LoginInput"];
  logout: undefined;
  recovery: DTO["PasswordResetRequest"];
  reset: DTO["PasswordResetInput"];
  invitation: DTO["RedeemInput"];
  preferences: DTO["PreferencesInput"];
  verifyRequest: undefined;
  verify: DTO["EmailVerificationInput"];
  challenge: DTO["CredentialChallengeInput"];
  password: DTO["CredentialChangeInput"];
  emailCurrent: DTO["CredentialChangeInput"];
  emailProposed: DTO["EmailVerificationInput"];
}
export type FailureKind =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "limited"
  | "unavailable"
  | "uncertain";
export class AccountFailure extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly retryAfter: number | null = null,
  ) {
    super("ACCOUNT_REQUEST_FAILED");
  }
}
function failed(response: Response): never {
  const map: Record<number, FailureKind> = {
    400: "invalid",
    401: "unauthorized",
    403: "forbidden",
    404: "unavailable",
    409: "conflict",
    422: "invalid",
    428: "conflict",
    429: "limited",
    503: "unavailable",
  };
  throw new AccountFailure(
    map[response.status] ?? "uncertain",
    retryDelay(response.headers.get("Retry-After")),
  );
}
export async function read<T extends z.ZodType>(path: string, schema: T, signal: AbortSignal) {
  const bounded = new AbortController();
  const abort = () => bounded.abort();
  if (signal.aborted) bounded.abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await withReadSlot(bounded.signal, () =>
      fetch(`/api/v1${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: bounded.signal,
        headers: { Accept: "application/json" },
      }),
    );
    if (response.status !== 200) failed(response);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new AccountFailure("unavailable");
    return { data: parsed.data as z.output<T>, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("unavailable");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export const readSelf = (signal: AbortSignal) => read("/me", selfEnvelope, signal);
export const readPending = (signal: AbortSignal) =>
  read("/me/email-change", pendingEnvelope, signal);
export interface Attempt {
  operation: Operation;
  payload: Inputs[Operation];
  key: string;
  serialized: string;
  etag: string | undefined;
  expires: number;
}
export function attemptFor<K extends Operation>(
  operation: K,
  payload: Inputs[K],
  etag: string | undefined,
  previous: Attempt | null,
  now = Date.now(),
): Attempt {
  const serialized = JSON.stringify([operation, payload, etag]);
  return previous && previous.expires > now && previous.serialized === serialized
    ? previous
    : {
        operation,
        payload: payload === undefined ? undefined : structuredClone(payload),
        key: crypto.randomUUID(),
        serialized,
        etag,
        expires: now + 10 * 60 * 1000,
      };
}
export async function command(attempt: Attempt, signal: AbortSignal) {
  const operation = operations[attempt.operation];
  try {
    const csrf = await read("/auth/csrf", csrfEnvelope, signal);
    const response = await fetch(`/api/v1${operation.path}`, {
      method: attempt.operation === "preferences" ? "PATCH" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrf.data.data.token,
        ...(attempt.payload === undefined ? {} : { "Content-Type": "application/json" }),
        ...(operation.keyed ? { "Idempotency-Key": attempt.key } : {}),
        ...(attempt.etag ? { "If-Match": attempt.etag } : {}),
      },
      ...(attempt.payload === undefined ? {} : { body: JSON.stringify(attempt.payload) }),
    });
    if (response.status !== operation.status) failed(response);
    const parsed = operation.schema.safeParse(await response.json());
    if (!parsed.success) throw new AccountFailure("uncertain");
    return parsed.data.data;
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("uncertain");
  }
}
