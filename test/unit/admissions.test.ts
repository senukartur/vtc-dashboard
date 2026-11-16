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
import {
  checkDto,
  steamIdFromProfileUrl,
} from "../../apps/api/src/modules/admissions/truckers-checks.ts";

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
test("each referral source is accepted alone; unknown or null sources and misplaced free text fail", () => {
  for (const referralSource of [
    "truckersmp",
    "discord",
    "friend_or_member",
    "youtube_or_twitch",
    "other",
  ] as const)
    expect(validateApplication({ ...input(), referralSource }).referralSource).toBe(referralSource);
  expect(
    validateApplication({
      ...input(),
      referralSource: "other",
      referralOther: "A fictional convoy poster",
    }).referralOther,
  ).toBe("A fictional convoy poster");
  for (const patch of [
    { referralSource: "newsletter" },
    { referralSource: null },
    { referralSource: undefined },
    { referralOther: "Text without a source" },
    { referralSource: "discord", referralOther: "Text with another source" },
    { referralSource: "other", referralOther: null },
    { referralSource: "other", referralOther: "" },
  ])
    expect(
      () => validateApplication({ ...input(), ...patch } as never),
      JSON.stringify(patch),
    ).toThrow(expect.objectContaining({ statusCode: 422 }));
});
test("referral free text counts code points and rejects what the MySQL nonblank CHECK would reject", () => {
  const other = (referralOther: string) => ({
    ...input(),
    referralSource: "other" as const,
    referralOther,
  });
  for (const accepted of [
    "x".repeat(200),
    "\u{1F69A}".repeat(200),
    " Fictional\tconvoy\r\nposter ",
    "\u180E",
    "\u200B",
    "\u00AD",
  ])
    expect(validateApplication(other(accepted)).referralOther).toBe(accepted);
  for (const rejected of [
    "x".repeat(201),
    "\u{1F69A}".repeat(201),
    "\uD800",
    "Fictional \uDC00 text",
    "\u0085",
    "Fictional\u0085text",
    "\u001C",
    "\u001F",
    "\u007F",
    "\u0000",
    " \t\r\n",
    "\u3000",
    "\uFEFF",
    "\u00A0\u2028\u2029\u202F\u205F\u1680\u2000\u200A",
  ])
    expect(() => validateApplication(other(rejected)), JSON.stringify(rejected)).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    );
});
test("legacy submissions keep their validated shape, so earlier idempotency fingerprints are unchanged", () => {
  expect(Object.keys(validateApplication(input())).sort()).toEqual([
    "discord",
    "email",
    "games",
    "introduction",
    "nickname",
    "steamProfileUrl",
  ]);
  expect(
    Object.keys(validateApplication({ ...input(), referralSource: "discord" })).sort(),
  ).toEqual([
    "discord",
    "email",
    "games",
    "introduction",
    "nickname",
    "referralSource",
    "steamProfileUrl",
  ]);
});
test("only canonical /profiles/ links yield a SteamID64 for the TruckersMP check", () => {
  expect(steamIdFromProfileUrl("https://steamcommunity.com/profiles/76561190000000001")).toBe(
    "76561190000000001",
  );
  expect(steamIdFromProfileUrl("https://steamcommunity.com/profiles/76561190000000001/")).toBe(
    "76561190000000001",
  );
  for (const url of [
    "https://steamcommunity.com/id/fictional",
    "https://steamcommunity.com/id/76561190000000001",
    "https://steamcommunity.com/profiles/06561190000000001",
    "https://steamcommunity.com/profiles/7656119000000000",
  ])
    expect(steamIdFromProfileUrl(url), url).toBeNull();
});
test("the check projection derives not_checked, hides transient failures and fails overdue checks", () => {
  const now = new Date("2026-11-12T09:00:00.000Z");
  const profilesUrl = "https://steamcommunity.com/profiles/76561190000000001";
  const empty = {
    found: null,
    playerId: null,
    displayName: null,
    profileUrl: null,
    bans: null,
    vtc: null,
    checkedAt: null,
    lastAttemptAt: null,
    failure: null,
  };
  expect(checkDto(null, "https://steamcommunity.com/id/fictional", now)).toEqual({
    state: "not_checked",
    notCheckedReason: "steam_vanity_url",
    ...empty,
  });
  expect(checkDto(undefined, profilesUrl, now)).toEqual({
    state: "not_checked",
    notCheckedReason: "not_requested",
    ...empty,
  });
  const base = {
    applicationId: newId(),
    generation: 1,
    steamId: "76561190000000001",
    requestedAt: new Date("2026-11-12T08:59:00.000Z"),
    found: null,
    profile: null,
    checkedAt: null,
    lastAttemptAt: new Date("2026-11-12T08:59:30.000Z"),
  };
  const checking = {
    ...base,
    state: "checking" as const,
    leaseId: newId(),
    leaseUntil: new Date(now.getTime() + 1),
    failure: "rate_limited" as const,
  };
  expect(checkDto(checking, profilesUrl, now)).toEqual({
    state: "checking",
    notCheckedReason: null,
    ...empty,
    lastAttemptAt: "2026-11-12T08:59:30.000Z",
  });
  expect(checkDto({ ...checking, leaseUntil: now }, profilesUrl, now)).toMatchObject({
    state: "failed",
    failure: "rate_limited",
  });
  expect(checkDto({ ...checking, leaseUntil: now, failure: null }, profilesUrl, now)).toMatchObject(
    { state: "failed", failure: "unavailable" },
  );
  const completed = {
    ...base,
    state: "completed" as const,
    leaseId: null,
    leaseUntil: null,
    failure: null,
    found: true,
    checkedAt: now,
    profile: {
      playerId: "900000000000001",
      displayName: "Fictional Applicant TMP",
      vtc: { inVtc: true, id: "900000000001", name: "Fictional Other VTC", tag: "FOV" },
      bans: { any: false, count: 0 },
    },
  };
  expect(checkDto(completed, profilesUrl, now)).toEqual({
    state: "completed",
    notCheckedReason: null,
    found: true,
    playerId: "900000000000001",
    displayName: "Fictional Applicant TMP",
    profileUrl: "https://truckersmp.com/user/900000000000001",
    bans: { any: false, count: 0 },
    vtc: { inVtc: true, id: "900000000001", name: "Fictional Other VTC", tag: "FOV" },
    checkedAt: "2026-11-12T09:00:00.000Z",
    lastAttemptAt: "2026-11-12T08:59:30.000Z",
    failure: null,
  });
  expect(checkDto({ ...completed, found: false, profile: null }, profilesUrl, now)).toMatchObject({
    state: "completed",
    found: false,
    playerId: null,
    bans: null,
    vtc: null,
  });
  expect(
    checkDto({ ...completed, state: "failed", failure: "invalid_response" }, profilesUrl, now),
  ).toMatchObject({ state: "failed", found: true, failure: "invalid_response" });
});
