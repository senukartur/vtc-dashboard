import { describe, expect, test } from "vitest";
import {
  countdown,
  leadershipView,
  readinessItems,
  secondsUntil,
  sourceBadges,
} from "../../apps/web/src/features/admin/settings-model.ts";
import { administrationTranslations } from "../../apps/web/src/features/admin/translations.ts";

const now = Date.parse("2026-11-02T12:00:00.000Z");
const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();

describe("secondsUntil and countdown", () => {
  test("round up, never go below zero and treat invalid values as zero", () => {
    expect(secondsUntil(at(0), now)).toBe(0);
    expect(secondsUntil(at(-30), now)).toBe(0);
    expect(secondsUntil(at(59), now)).toBe(59);
    expect(secondsUntil(new Date(now + 59_001).toISOString(), now)).toBe(60);
    expect(secondsUntil(at(600), now)).toBe(600);
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil("not-a-date", now)).toBe(0);
  });
  test("format m:ss in ASCII", () => {
    expect(countdown(0)).toBe("0:00");
    expect(countdown(59)).toBe("0:59");
    expect(countdown(60)).toBe("1:00");
    expect(countdown(600)).toBe("10:00");
    expect(countdown(-5)).toBe("0:00");
    expect(countdown(Number.NaN)).toBe("0:00");
  });
});

describe("leadershipView", () => {
  const pending = { expiresAt: at(552), attemptsRemaining: 5 };
  const base = {
    pending: null,
    requested: false,
    changing: false,
    resendAvailableAt: null,
    requestSeconds: 0,
    now,
  };
  test("without a code the successor step allows a request", () => {
    expect(leadershipView(base)).toEqual({
      step: "successor",
      expired: false,
      gone: false,
      codeUsable: false,
      attemptsLeft: null,
      expiresIn: 0,
      resendIn: 0,
      canRequest: true,
    });
  });
  test("a pending code shows the code step with server attempts and expiry", () => {
    const view = leadershipView({ ...base, pending, requested: true });
    expect(view).toMatchObject({
      step: "code",
      codeUsable: true,
      expired: false,
      gone: false,
      attemptsLeft: 5,
      expiresIn: 552,
    });
    expect(
      leadershipView({ ...base, pending: { ...pending, attemptsRemaining: 3 } }).attemptsLeft,
    ).toBe(3);
  });
  test("Change successor forces the successor step even with a pending code", () => {
    expect(leadershipView({ ...base, pending, requested: true, changing: true }).step).toBe(
      "successor",
    );
  });
  test("at and after expiry the code is expired and unusable", () => {
    for (const expiresAt of [at(0), at(-1)]) {
      const view = leadershipView({ ...base, pending: { ...pending, expiresAt }, requested: true });
      expect(view).toMatchObject({ step: "code", expired: true, codeUsable: false, expiresIn: 0 });
    }
  });
  test("a requested code the server stops reporting is gone, not a silent reset", () => {
    expect(leadershipView({ ...base, requested: true })).toMatchObject({
      step: "code",
      gone: true,
      codeUsable: false,
      attemptsLeft: null,
    });
  });
  test("a code with no attempts left is unusable", () => {
    expect(
      leadershipView({ ...base, pending: { ...pending, attemptsRemaining: 0 } }).codeUsable,
    ).toBe(false);
  });
  test("a new request waits for both resendAvailableAt and Retry-After", () => {
    expect(leadershipView({ ...base, resendAvailableAt: at(48) })).toMatchObject({
      resendIn: 48,
      canRequest: false,
    });
    expect(leadershipView({ ...base, requestSeconds: 42 })).toMatchObject({
      resendIn: 42,
      canRequest: false,
    });
    expect(
      leadershipView({ ...base, resendAvailableAt: at(10), requestSeconds: 42 }).resendIn,
    ).toBe(42);
    expect(
      leadershipView({ ...base, resendAvailableAt: at(70), requestSeconds: 42 }).resendIn,
    ).toBe(70);
    expect(
      leadershipView({ ...base, resendAvailableAt: at(-1), requestSeconds: 0 }).canRequest,
    ).toBe(true);
  });
});

describe("readinessItems", () => {
  test("lists the known items first and flags unknown codes", () => {
    expect(readinessItems({ reportingTimezone: "Europe/Warsaw", missingSetup: [] })).toEqual([
      { code: "company_reporting_timezone", ok: true, known: true },
      { code: "qualification_configuration", ok: true, known: true },
    ]);
    expect(
      readinessItems({
        reportingTimezone: "Europe/Warsaw",
        missingSetup: ["qualification_configuration"],
      }),
    ).toEqual([
      { code: "company_reporting_timezone", ok: true, known: true },
      { code: "qualification_configuration", ok: false, known: true },
    ]);
    expect(
      readinessItems({
        reportingTimezone: null,
        missingSetup: ["company_reporting_timezone", "qualification_configuration"],
      }),
    ).toEqual([
      { code: "company_reporting_timezone", ok: false, known: true },
      { code: "qualification_configuration", ok: false, known: true },
    ]);
    expect(
      readinessItems({ reportingTimezone: "UTC", missingSetup: ["future_setup_step"] }),
    ).toEqual([
      { code: "company_reporting_timezone", ok: true, known: true },
      { code: "qualification_configuration", ok: true, known: true },
      { code: "future_setup_step", ok: false, known: false },
    ]);
  });
  test("an unset timezone is never ready even if the server omitted the code", () => {
    expect(readinessItems({ reportingTimezone: null, missingSetup: [] })[0]?.ok).toBe(false);
  });
});

test("sourceBadges separates implementation from runtime state", () => {
  for (const runtimeEnabled of [true, false]) {
    expect(sourceBadges({ implemented: true, runtimeEnabled })).toEqual({
      implemented: "implemented",
      runtime: runtimeEnabled ? "enabled" : "disabled",
    });
    // Deferred company adapters (Trucky, VTCBase) are unavailable whatever the runtime flag says.
    expect(sourceBadges({ implemented: false, runtimeEnabled })).toEqual({
      implemented: "planned",
      runtime: "unavailable",
    });
  }
});

test("every settingsUi string is non-empty in EN and RU and the slogan is absent", () => {
  function strings(value: object, prefix = ""): [string, string][] {
    return Object.entries(value).flatMap(([key, item]) =>
      typeof item === "object"
        ? strings(item as object, `${prefix}${key}.`)
        : [[`${prefix}${key}`, String(item)] as [string, string]],
    );
  }
  const en = strings(administrationTranslations.en.settingsUi),
    ru = strings(administrationTranslations.ru.settingsUi);
  expect(en.map(([key]) => key)).toEqual(ru.map(([key]) => key));
  for (const [key, text] of [...en, ...ru]) expect(text.trim(), key).not.toBe("");
  for (const provider of ["ets2telemetry", "manual", "trucky", "vtcbase"])
    expect(en.map(([key]) => key)).toContain(`sourceNote.${provider}`);
  expect(JSON.stringify(administrationTranslations)).not.toMatch(/Достаточно суров|Юкон\?/);
  // No company name, public page or Discord settings are offered here.
  expect(JSON.stringify([en, ru])).not.toMatch(/Discord|public page|публичн/i);
});
