import { randomBytes } from "node:crypto";
import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test } from "vitest";
import {
  admissionsSecurity,
  validateApplication,
} from "../../apps/api/src/modules/admissions/security.ts";
import { admissionsEvent } from "../../apps/api/src/platform/outbox/events.ts";
import {
  cleanupAdmissions,
  createAdmissions,
} from "../../apps/api/src/modules/admissions/service.ts";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";

const config = { key: randomBytes(32).toString("base64url"), origin: "http://127.0.0.1:4173" };
const input = () => ({
  nickname: "Fictional Driver",
  email: "fictional@example.invalid",
  steamProfileUrl: "https://steamcommunity.com/id/fictional",
  games: ["ets2" as const],
});
test("admissions opt-in requires identity and an independent canonical encryption key, retaining safe defaults", () => {
  const base = {
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3307",
    MYSQL_USER: "synthetic",
    MYSQL_DATABASE: "synthetic",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
  };
  expect(readConfig(base).admissions).toBe(undefined);
  const identity = {
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: randomBytes(32).toString("base64url"),
    IDENTITY_ORIGIN: config.origin,
  };
  expect(
    Boolean(
      readConfig({
        ...base,
        ...identity,
        ADMISSIONS_ENABLED: "true",
        ADMISSIONS_ENCRYPTION_KEY: config.key,
      }).admissions,
    ),
  ).toBe(true);
  for (const patch of [
    { ADMISSIONS_ENABLED: "yes" },
    { ADMISSIONS_ENABLED: "true" },
    { ...identity, ADMISSIONS_ENABLED: "true", ADMISSIONS_ENCRYPTION_KEY: "REPLACE_PRIVATE_KEY" },
    {
      ...identity,
      ADMISSIONS_ENABLED: "true",
      ADMISSIONS_ENCRYPTION_KEY: identity.IDENTITY_SECRET,
    },
  ])
    expect(() => readConfig({ ...base, ...patch })).toThrow(/^Invalid environment fields:/);
});
test("admissions availability is safe 503 without blind retry and unknown COMMIT stays uncertain; disabled cleanup notices absent schema", async () => {
  let runs = 0;
  const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_DATABASE_MESSAGE"), {
    code: "ECONNREFUSED",
  });
  const unit: UnitOfWork = {
    client: () => {
      throw new Error("SYNTHETIC_UNREACHABLE");
    },
    close: async () => {},
    run: async () => {
      runs++;
      throw failure;
    },
  };
  await expect(
    createAdmissions(unit, config, {} as never).rateLimit("submit", "synthetic"),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(runs).toBe(1);
  unit.run = async () => {
    runs++;
    throw new TransactionCommitOutcomeUnknownError(failure);
  };
  await expect(
    createAdmissions(unit, config, {} as never).rateLimit("submit", "synthetic"),
  ).rejects.toBeInstanceOf(TransactionCommitOutcomeUnknownError);
  expect(runs).toBe(2);
  unit.run = async () => {
    throw Object.assign(new Error("SYNTHETIC_ABSENT_TABLE"), { code: "ER_NO_SUCH_TABLE" });
  };
  expect(await cleanupAdmissions(unit, false)).toBe("configuration_pending");
  await expect(cleanupAdmissions(unit, true)).rejects.toThrow("SYNTHETIC_ABSENT_TABLE");
});
test("minimal application and all selected game combinations normalize optional fields without changing facts", () => {
  for (const games of [["ets2"], ["ats"], ["ets2", "ats"]] as const) {
    const normalized = validateApplication({ ...input(), games: [...games] });
    expect(normalized.discord).toBe(null);
    expect(normalized.introduction).toBe(null);
    expect(normalized.games).toEqual([...games].sort());
  }
  expect(
    validateApplication({
      ...input(),
      steamProfileUrl: "https://steamcommunity.com/id/a",
      discord: null,
    }).steamProfileUrl,
  ).toBe("https://steamcommunity.com/id/a");
  expect(
    validateApplication({
      ...input(),
      steamProfileUrl: "https://steamcommunity.com/profiles/76561198000000000/",
    }).games,
  ).toEqual(["ets2"]);
});
test("application semantic boundary rejects whitespace, malformed mailbox, unsafe URL components and unsupported facts", () => {
  for (const patch of [
    { nickname: "  " },
    { email: "fictional@example.invalid\r\nBcc:other@example.invalid" },
    { email: "x".repeat(255) },
    { games: [] },
    { games: ["ets2", "ets2"] },
    { games: ["unknown"] },
    { discord: " " },
    { introduction: "\u0000" },
    { steamProfileUrl: "http://steamcommunity.com/id/fictional" },
    { steamProfileUrl: "https://steamcommunity.com.evil.invalid/id/fictional" },
    { steamProfileUrl: "https://user:pass@steamcommunity.com/id/fictional" },
    { steamProfileUrl: "https://steamcommunity.com/id/fictional?x=1" },
    { steamProfileUrl: "https://steamcommunity.com/id/fictional#x" },
    { steamProfileUrl: "https://steamcommunity.com/id/fictional/other" },
    { steamProfileUrl: "https://steamcommunity.com:443/id/fictional" },
    { steamProfileUrl: "https://steamcommunity.com/id/fictional\n" },
    { extra: true },
  ])
    expect(() => validateApplication({ ...input(), ...patch } as never)).toThrow();
});
test("invitation ciphertext authenticates generation, application, origin, key and bytes; cursor authenticates scope", () => {
  const crypto = admissionsSecurity(config),
    id = newId(),
    app = newId(),
    token = crypto.token(),
    sealed = crypto.seal(id, app, token);
  expect(sealed.includes(token)).toBe(false);
  expect(crypto.open(id, app, sealed)).toBe(token);
  expect(() => crypto.open(newId(), app, sealed)).toThrow();
  expect(() => crypto.open(id, newId(), sealed)).toThrow();
  expect(() =>
    admissionsSecurity({ ...config, key: randomBytes(32).toString("base64url") }).open(
      id,
      app,
      sealed,
    ),
  ).toThrow();
  expect(() =>
    admissionsSecurity({ ...config, origin: "https://other.example.invalid" }).open(
      id,
      app,
      sealed,
    ),
  ).toThrow();
  const bytes = Buffer.from(sealed, "base64url");
  bytes[20] = (bytes[20] ?? 0) ^ 1;
  expect(() => crypto.open(id, app, bytes.toString("base64url"))).toThrow();
  const at = "2026-10-19T12:00:00.001Z",
    cursor = crypto.cursor("actor:history", at, id);
  expect(crypto.readCursor("actor:history", cursor)).toEqual({ at, id });
  expect(() => crypto.readCursor("other:history", cursor)).toThrow();
  expect(() => crypto.readCursor("actor:history", `${cursor}x`)).toThrow();
  expect(crypto.digest("scope", "abc").equals(crypto.digest("command", "abc"))).toBe(false);
});
test("safe admissions events reject private extensions and unsupported event kinds", () => {
  const id = newId(),
    eventId = newId(),
    e = {
      eventId,
      type: "application.submitted",
      schemaVersion: 1,
      aggregate: { kind: "application", id, version: 1 },
      occurredAt: "2026-10-19T12:00:00.001Z",
      correlationId: eventId,
      causationId: null,
      data: { applicationId: id },
    };
  expect(admissionsEvent(e).data).toEqual({ applicationId: id });
  expect(() =>
    admissionsEvent({ ...e, data: { applicationId: id, email: "fictional@example.invalid" } }),
  ).toThrow();
  expect(() => admissionsEvent({ ...e, type: "unknown" })).toThrow();
});
