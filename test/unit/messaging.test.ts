import { randomBytes } from "node:crypto";
import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test } from "vitest";
import {
  kinds,
  mailCrypto,
  type MailIntent,
  mailbox,
  render,
  validateIntent,
} from "../../apps/api/src/modules/messaging/content.ts";
import {
  classify,
  localProvider,
  resendProvider,
} from "../../apps/api/src/modules/messaging/provider.ts";
import {
  cleanupMail,
  validateMessagingConfig,
} from "../../apps/api/src/modules/messaging/service.ts";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";

const origin = "https://dashboard.example.invalid";
const key = () => randomBytes(32).toString("hex");
const intent = (): MailIntent => ({
  owner: "identity",
  generationId: newId(),
  userId: newId(),
  kind: "password_change",
  locale: "en",
  recipient: "fictional@example.invalid",
  expiresAt: "2026-10-19T12:10:00.000Z",
  code: "NONFUNCTIONAL_SYNTHETIC_CODE",
});
test("disabled keyless cleanup reports only missing table/grants as pending and never hides unknown COMMIT or availability failures", async () => {
  const denied = Object.assign(new Error("SYNTHETIC_PRIVATE_DETAIL"), {
    code: "ER_TABLEACCESS_DENIED_ERROR",
  });
  const missing = Object.assign(new Error("SYNTHETIC_PRIVATE_DETAIL"), {
    code: "ER_NO_SUCH_TABLE",
  });
  const errors = [
    denied,
    missing,
    Object.assign(new Error("SYNTHETIC_PRIVATE_DETAIL"), { code: "ECONNREFUSED" }),
    new TransactionCommitOutcomeUnknownError(denied),
    new Error("SYNTHETIC_PRIVATE_DETAIL"),
  ];
  for (const error of errors) {
    const unit = {
      run: async () => {
        throw error;
      },
    } as unknown as UnitOfWork;
    if (error === denied || error === missing)
      expect(await cleanupMail(unit, false)).toBe("configuration_pending");
    else await expect(cleanupMail(unit, false)).rejects.toBe(error);
    await expect(cleanupMail(unit, true)).rejects.toBe(error);
  }
});
test("all security and admissions templates render both locales with escaped private content", () => {
  for (const locale of ["ru", "en"] as const)
    for (const kind of kinds) {
      const input: MailIntent = { ...intent(), kind, locale };
      if (kind === "email_change") input.stage = "proposed_email";
      if (["invitation", "rejection"].includes(kind)) {
        input.owner = "admissions";
        input.userId = null;
        delete input.code;
        if (kind === "invitation") input.link = `${origin}/invitation?token=NONFUNCTIONAL_EXAMPLE`;
        else input.reason = '<script>alert("fictional")</script>\nПричина / Reason';
      }
      const request = render(validateIntent(input, origin), "sender@example.invalid", origin);
      expect(request.to).toEqual([input.recipient]);
      expect(request.html.includes("<script>")).toBe(false);
      expect(request.html).toContain(`lang="${locale}"`);
      expect(request.subject.length).toBeGreaterThan(5);
      expect(request.text).toContain(input.expiresAt);
      if (kind === "email_change") {
        const current = render(
          validateIntent({ ...input, stage: "current_email" }, origin),
          "sender@example.invalid",
          origin,
        );
        expect(current.text).toContain(locale === "ru" ? "текущая почта" : "current email");
        expect(request.text).toContain(locale === "ru" ? "новая почта" : "proposed email");
      }
    }
});
test("closed inputs reject injection, off-origin invitation links and malformed addresses", () => {
  for (const recipient of [
    "a@example.invalid\r\nBcc: b@example.invalid",
    "bad",
    "a b@example.invalid",
    "A <a@example.invalid>",
  ])
    expect(() => mailbox(recipient)).toThrow();
  for (const input of [
    { ...intent(), extra: true },
    { ...intent(), code: "two words" },
    { ...intent(), reason: "unexpected" },
    { ...intent(), locale: "fr" },
    {
      ...intent(),
      owner: "admissions",
      userId: null,
      kind: "invitation",
      code: undefined,
      link: "https://foreign.example.invalid/invitation?token=NONFUNCTIONAL",
    },
  ])
    expect(() => validateIntent(input as MailIntent, origin)).toThrow();
  let read = false;
  const getter = Object.defineProperty(intent(), "code", {
    enumerable: true,
    get() {
      read = true;
      return "bad";
    },
  });
  expect(() => validateIntent(getter, origin)).toThrow();
  expect(read).toBe(false);
});
test("authenticated encryption is randomized and bound to delivery identity; wrong key and corruption fail closed", () => {
  const crypto = mailCrypto(key()),
    id = newId(),
    input = intent(),
    privateMail = {
      providerBinding: "synthetic",
      intent: input,
      request: render(input, "sender@example.invalid", origin),
    };
  const first = crypto.seal(id, privateMail),
    second = crypto.seal(id, privateMail);
  expect(first === second).toBe(false);
  expect(first.includes(input.recipient)).toBe(false);
  expect(crypto.open(id, first)).toEqual(privateMail);
  for (const operation of [
    () => crypto.open(newId(), first),
    () => mailCrypto(key()).open(id, first),
    () => crypto.open(id, first.slice(0, -8)),
    () => mailCrypto(""),
  ])
    expect(operation).toThrow();
  expect(crypto.fingerprint(input).equals(crypto.fingerprint({ ...input }))).toBe(true);
  expect(
    crypto
      .fingerprint(input)
      .equals(crypto.fingerprint({ ...input, recipient: "changed@example.invalid" })),
  ).toBe(false);
});
test.each([
  [429, "rate_limit_exceeded", "rate_limit", true],
  [429, "daily_quota_exceeded", "daily_quota", true],
  [429, "monthly_quota_exceeded", "monthly_quota", false],
  [401, "validation_error", "authentication", false],
  [422, "validation_error", "validation", false],
  [409, "invalid_idempotent_request", "idempotency_conflict", false],
  [409, "concurrent_idempotent_requests", "concurrent_request", true],
  [503, "service_unavailable", "provider_unavailable", true],
])(
  "provider rejection %i/%s has a fixed safe recovery category",
  (status, name, category, retry) => {
    const result = classify(status as number, name);
    expect(result.state).toBe("rejected");
    if (result.state === "rejected") {
      expect(result.category).toBe(category);
      expect(result.retryAfterMs !== null).toBe(retry);
    }
  },
);
test("Resend sends one frozen request/key to fixed HTTPS endpoint; receipts are bounded opaque provider IDs", async () => {
  const request = render(intent(), "sender@example.invalid", origin),
    calls: unknown[] = [];
  const transport = (async (url, input) => {
    calls.push({
      url,
      input: {
        method: input?.method,
        headers: input?.headers,
        body: input?.body,
        redirect: input?.redirect,
      },
    });
    return new Response(JSON.stringify({ id: "opaque_provider_receipt.v9" }), { status: 200 });
  }) as typeof fetch;
  const provider = resendProvider("NONFUNCTIONAL_TEST_PROVIDER_KEY", transport);
  for (let n = 0; n < 2; n++)
    expect(
      await provider.send(request, "messaging.mail:stable-key", new AbortController().signal),
    ).toEqual({ state: "accepted", receipt: "opaque_provider_receipt.v9" });
  expect(calls[0]).toEqual(calls[1]);
  expect((calls[0] as { url: string }).url).toBe("https://api.resend.com/emails");
});
test("response loss, invalid receipts, redirects, oversized responses and transport failures remain ambiguous without raw content", async () => {
  for (const response of [
    () => {
      throw new Error("PRIVATE_PROVIDER_DETAIL");
    },
    () => new Response("invalid PRIVATE_PROVIDER_DETAIL"),
    () => new Response(JSON.stringify({ id: "bad\r\nreceipt" })),
    () => new Response("x".repeat(9000)),
  ]) {
    const provider = resendProvider("NONFUNCTIONAL_TEST_PROVIDER_KEY", (async () =>
      response()) as typeof fetch);
    expect(
      await provider.send(
        render(intent(), "sender@example.invalid", origin),
        "key",
        new AbortController().signal,
      ),
    ).toEqual({ state: "ambiguous", category: "acceptance_unknown" });
  }
});
test("local sink makes simulated status explicit and production configuration fails closed", async () => {
  expect(
    (
      await localProvider().send(
        render(intent(), "sender@example.invalid", origin),
        "stable-key",
        new AbortController().signal,
      )
    ).state,
  ).toBe("simulated");
  const config = {
    mode: "local" as const,
    key: key(),
    sender: "sender@example.invalid",
    origin,
    production: true,
  };
  expect(() => validateMessagingConfig(config)).toThrow();
  expect(() => validateMessagingConfig({ ...config, production: false })).not.toThrow();
  const base = {
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3307",
    MYSQL_DATABASE: "synthetic",
    MYSQL_USER: "synthetic",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
  };
  expect(readConfig(base).mail).toBeUndefined();
  expect(() => readConfig({ ...base, MAIL_MODE: "resend" })).toThrow("Invalid environment fields");
});
