import { expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { identityError } from "../../apps/api/src/modules/identity/service.ts";
import { successionWindow } from "../../apps/api/src/modules/identity/succession-limits.ts";

const start = Date.parse("2026-10-17T12:00:00.000Z");
const at = (offsetMs: number) => new Date(start + offsetMs);

test("no previous issuance allows a code now with no resend time", () => {
  expect(successionWindow([], at(0))).toEqual({ allowed: true, resendAvailableAt: null });
});

test("the 60-second cooldown refuses at 59 999 ms and allows exactly at 60 000 ms", () => {
  expect(successionWindow([at(0)], at(59999))).toEqual({
    allowed: false,
    resendAvailableAt: at(60000),
  });
  expect(successionWindow([at(0)], at(60000))).toEqual({ allowed: true, resendAvailableAt: null });
  // The latest issuance decides the cooldown regardless of input order.
  expect(successionWindow([at(120000), at(0)], at(150000))).toEqual({
    allowed: false,
    resendAvailableAt: at(180000),
  });
});

test("five codes in 60 minutes refuse a sixth until the oldest leaves the half-open window", () => {
  const issued = [0, 1, 2, 3, 4].map((index) => at(index * 60000));
  const releasedAt = at(3600000);
  expect(successionWindow(issued, at(5 * 60000))).toEqual({
    allowed: false,
    resendAvailableAt: releasedAt,
  });
  expect(successionWindow(issued, at(3599999))).toEqual({
    allowed: false,
    resendAvailableAt: releasedAt,
  });
  expect(successionWindow(issued, releasedAt)).toEqual({ allowed: true, resendAvailableAt: null });
  // Four codes inside the window only apply the cooldown.
  expect(successionWindow(issued.slice(0, 4), at(4 * 60000))).toEqual({
    allowed: true,
    resendAvailableAt: null,
  });
});

test("the later of the cooldown and hourly release is reported", () => {
  // Five issuances; the latest is recent enough that its cooldown ends after the hourly release.
  const issued = [at(0), at(60000), at(120000), at(180000), at(3590000)];
  expect(successionWindow(issued, at(3595000))).toEqual({
    allowed: false,
    resendAvailableAt: at(3650000),
  });
});

test("issuances 60 minutes old or older are ignored by the hourly cap", () => {
  const old = [0, 1, 2, 3, 4].map((index) => at(index * 1000));
  expect(successionWindow(old, at(3604000))).toEqual({ allowed: true, resendAvailableAt: null });
  const mixed = [...old, at(3700000), at(3760000), at(3820000), at(3880000)];
  expect(successionWindow(mixed, at(3940000))).toEqual({ allowed: true, resendAvailableAt: null });
  expect(successionWindow([...mixed, at(3940000)], at(4000000))).toEqual({
    allowed: false,
    resendAvailableAt: at(3700000 + 3600000),
  });
});

test("429 Retry-After uses a safe precise wait and otherwise keeps 60 seconds with an unchanged body", async () => {
  const app = await createApp({ checkReadiness: async () => true });
  const cases: [unknown, string][] = [
    [59, "59"],
    [1, "1"],
    [3600, "3600"],
    [undefined, "60"],
    [0, "60"],
    [3601, "60"],
    [1.5, "60"],
    ["30", "60"],
  ];
  cases.forEach(([value], index) => {
    app.get(`/api/v1/synthetic-limit/${index}`, async () => {
      throw value === undefined
        ? identityError(429)
        : Object.assign(identityError(429), { retryAfter: value });
    });
  });
  try {
    for (const [index, [, header]] of cases.entries()) {
      const response = await app.inject(`/api/v1/synthetic-limit/${index}`);
      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe(header);
      expect(response.json().error).toEqual({
        code: "RATE_LIMITED",
        messageKey: "errors.rate_limited",
        retryable: false,
      });
    }
  } finally {
    await app.close();
  }
});
