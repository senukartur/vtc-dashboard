import { browserSchemaDocument, browserSchemaRef } from "@vtc/contracts/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applicationPayload,
  applicationSchema,
  referralSources,
} from "../../apps/web/src/features/admissions/schema.ts";
import { admissionsTranslations } from "../../apps/web/src/features/admissions/translations.ts";
import {
  ApplicationFailure,
  retryDelay,
  submissionAttempt,
  submitApplication,
} from "../../apps/web/src/features/admissions/transport.ts";
const fields = {
  nickname: "Fictional Applicant",
  email: "applicant@example.invalid",
  steamProfileUrl: "https://steamcommunity.com/id/fictional-driver",
  games: ["ets2" as const],
  discord: "",
  introduction: "",
};
const meta = { requestId: "synthetic-request" };
const csrf = { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta };
const receipt = { data: { id: "41000000-0000-4000-8000-000000000001", version: 1 }, meta };
afterEach(() => vi.unstubAllGlobals());
describe("public application technical validation", () => {
  test("scenario 6 accepts either/both games and omits blank optional fields using the approved wire schema", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats.default(ajv);
    ajv.addSchema(browserSchemaDocument);
    const valid = ajv.compile(browserSchemaRef("ApplicationInput"));
    for (const games of [["ets2"], ["ats"], ["ets2", "ats"]] as const) {
      const parsed = applicationSchema.parse({
        ...fields,
        games,
        discord: "   ",
        introduction: "\n",
      });
      const payload = applicationPayload(parsed);
      expect(valid(payload)).toBe(true);
      expect(payload).not.toHaveProperty("discord");
      expect(payload).not.toHaveProperty("introduction");
    }
  });
  test("rejects blank/bounds/unsupported game/Steam and malformed text, while allowing boundary values", () => {
    for (const bad of [
      { nickname: " " },
      { nickname: "a".repeat(129) },
      { email: "invalid" },
      { email: `${"a".repeat(250)}@example.invalid` },
      { games: [] },
      { games: ["ets2", "ets2"] },
      { games: ["other"] },
      { discord: "a".repeat(257) },
      { introduction: "a".repeat(4001) },
      { nickname: "\u0001" },
      { nickname: "\ud800" },
    ])
      expect(applicationSchema.safeParse({ ...fields, ...bad }).success).toBe(false);
    for (const steamProfileUrl of [
      "http://steamcommunity.com/id/fixture",
      "https://steamcommunity.com/id/fixture?token=synthetic",
      "https://steamcommunity.com/id/fixture#fragment",
      "https://steamcommunity.com/profiles/123",
      "https://example.invalid/id/fixture",
      "https://steamcommunity.com/id/fixture/extra",
    ])
      expect(applicationSchema.safeParse({ ...fields, steamProfileUrl }).success).toBe(false);
    expect(
      applicationSchema.safeParse({
        ...fields,
        nickname: "a".repeat(128),
        discord: "a".repeat(256),
        introduction: "a".repeat(4000),
        steamProfileUrl: "https://steamcommunity.com/profiles/00000000000000000/",
      }).success,
    ).toBe(true);
  });
});
describe("referral source answer", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats.default(ajv);
  ajv.addSchema(browserSchemaDocument);
  const valid = ajv.compile(browserSchemaRef("ApplicationInput"));
  const other = (referralOther: string) => ({
    ...fields,
    referralSource: "other" as const,
    referralOther,
  });
  const definitions = browserSchemaDocument.$defs as unknown as Record<
    string,
    { properties: Record<string, { enum?: string[] }> }
  >;
  test("the options equal the contract enum and every option has RU/EN labels", () => {
    expect([...referralSources].sort()).toEqual(
      [...(definitions.ApplicationInput?.properties.referralSource?.enum ?? [])].sort(),
    );
    for (const language of ["ru", "en"] as const) {
      const strings = admissionsTranslations[language];
      for (const source of referralSources)
        expect(strings.referralOptions[source].trim()).not.toBe("");
      for (const text of [
        strings.referralSource,
        strings.referralNone,
        strings.referralOther,
        strings.referralCount,
        strings.errors.referralOther,
      ])
        expect(text.trim()).not.toBe("");
    }
  });
  test("an unanswered question keeps the earlier payload byte for byte", () => {
    const legacy = JSON.stringify(applicationPayload(fields));
    for (const extra of [
      {},
      { referralSource: "" as const, referralOther: "" },
      { referralSource: "" as const, referralOther: "Fictional poster" },
    ]) {
      const parsed = applicationSchema.parse({ ...fields, ...extra });
      expect(JSON.stringify(applicationPayload(parsed))).toBe(legacy);
    }
    expect(legacy).not.toMatch(/referral/);
  });
  test("a chosen source is sent alone; text typed for other is dropped after switching", () => {
    for (const source of referralSources.filter((item) => item !== "other"))
      for (const referralOther of ["", "Fictional poster", "x".repeat(201)]) {
        const parsed = applicationSchema.safeParse({
          ...fields,
          referralSource: source,
          referralOther,
        });
        expect(parsed.success).toBe(true);
        const payload = applicationPayload(parsed.data ?? fields);
        expect(payload).toEqual({ ...applicationPayload(fields), referralSource: source });
        expect(valid(payload)).toBe(true);
      }
  });
  test("other without text, or with only blank text, sends just the source", () => {
    for (const referralOther of ["", "   ", "\n\t", "\u3000", "\ufeff", "\u0085", "\u00a0\u2028"]) {
      const parsed = applicationSchema.safeParse(other(referralOther));
      expect(parsed.success).toBe(true);
      const payload = applicationPayload(parsed.data ?? fields);
      expect(payload.referralSource).toBe("other");
      expect(payload).not.toHaveProperty("referralOther");
      expect(valid(payload)).toBe(true);
    }
  });
  test("accepted free text is sent untrimmed and satisfies the contract", () => {
    for (const referralOther of [
      "x".repeat(200),
      "\u{1f69a}".repeat(200),
      " Fictional\tconvoy\r\nposter ",
      "\u180e",
      "\u200b",
      "\u00ad",
    ]) {
      const parsed = applicationSchema.safeParse(other(referralOther));
      expect(parsed.success).toBe(true);
      const payload = applicationPayload(parsed.data ?? fields);
      expect(payload.referralOther).toBe(referralOther);
      expect(valid(payload)).toBe(true);
    }
  });
  test("over-long text, lone surrogates and control characters are field errors", () => {
    for (const referralOther of [
      "x".repeat(201),
      "\u{1f69a}".repeat(201),
      "\ud800",
      "Fictional \udc00 text",
      "Fictional\u0085poster",
      "Fictional\u001cposter",
      "Fictional\u007fposter",
      "Fictional\u0000poster",
      "\u001c",
      "\u007f",
    ]) {
      const parsed = applicationSchema.safeParse(other(referralOther));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([["referralOther"]]);
    }
  });
  test("referral text errors are reported together with other field errors", () => {
    const parsed = applicationSchema.safeParse({ ...other("x".repeat(201)), nickname: " " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual([
      "nickname",
      "referralOther",
    ]);
  });
});
describe("same-origin admissions transport", () => {
  test("uses CSRF, language, credentials and a single idempotent POST; accepted result stays private", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(csrf))
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(
      submitApplication(applicationPayload(fields), receipt.data.id, "ru", signal),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/csrf");
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/v1/public/applications",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        signal,
        headers: expect.objectContaining({
          "Idempotency-Key": receipt.data.id,
          "X-CSRF-Token": csrf.data.token,
          "Accept-Language": "ru",
        }),
        body: JSON.stringify(applicationPayload(fields)),
      }),
    ]);
  });
  test.each([
    [422, "invalid"],
    [403, "forbidden"],
    [409, "conflict"],
    [429, "limited"],
    [503, "unavailable"],
    [404, "unavailable"],
  ])("safe %s feedback never reads or exposes a server payload", async (status, kind) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(csrf))
      .mockResolvedValueOnce(
        Response.json(
          { private: "PRIVATE_SENTINEL" },
          { status: Number(status), headers: { "Retry-After": "60" } },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      submitApplication(
        applicationPayload(fields),
        receipt.data.id,
        "en",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test.each([
    Response.json({ ...receipt, private: "PRIVATE_SENTINEL" }, { status: 201 }),
    Response.json(receipt, { status: 200 }),
    new Response("{", { status: 201 }),
    Response.json({ data: { id: "bad", version: 1 }, meta }, { status: 201 }),
  ])("malformed/unexpected response remains uncertain", async (response) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(Response.json(csrf)).mockResolvedValueOnce(response),
    );
    await expect(
      submitApplication(
        applicationPayload(fields),
        receipt.data.id,
        "en",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "uncertain" });
  });
  test("network failure does not automatically retry and unchanged retries preserve payload/key", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("PRIVATE_NETWORK_DETAIL"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      submitApplication(
        applicationPayload(fields),
        receipt.data.id,
        "en",
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ApplicationFailure);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const first = submissionAttempt(applicationPayload(fields), "en", null, () => "first");
    expect(submissionAttempt(applicationPayload(fields), "en", first, () => "unused")).toBe(first);
    expect(
      submissionAttempt(
        applicationPayload({ ...fields, nickname: "Changed" }),
        "en",
        first,
        () => "second",
      ).key,
    ).toBe("second");
    expect(first.payload.nickname).toBe(fields.nickname);
  });
  test.each(["en", "ru"] as const)(
    "unchanged retries retain the original %s command locale; changed payload captures the current locale",
    (locale) => {
      const changedLocale = locale === "en" ? "ru" : "en";
      const first = submissionAttempt(applicationPayload(fields), locale, null, () => "first");
      const replay = submissionAttempt(
        applicationPayload(fields),
        changedLocale,
        first,
        () => "unused",
      );
      expect(replay).toBe(first);
      expect(replay.locale).toBe(locale);
      const changed = submissionAttempt(
        applicationPayload({ ...fields, nickname: "Changed" }),
        changedLocale,
        replay,
        () => "second",
      );
      expect(changed.locale).toBe(changedLocale);
      expect(changed.key).toBe("second");
      expect(first.locale).toBe(locale);
    },
  );
  test("Retry-After is bounded and ignores malformed/raw text", () => {
    expect(retryDelay("60")).toBe(60);
    expect(retryDelay("999999")).toBe(3600);
    for (const raw of [null, "0", "-1", "PRIVATE_SENTINEL", "1.5"])
      expect(retryDelay(raw)).toBeNull();
  });
});
