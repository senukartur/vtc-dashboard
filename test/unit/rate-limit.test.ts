import { createRequire } from "node:module";
import { afterEach, expect, test, vi } from "vitest";
import { createAppQueryClient } from "../../apps/web/src/app/session-cache.ts";
import { AccountFailure } from "../../apps/web/src/features/account/transport.ts";
import { core } from "../../apps/web/src/i18n/core/resources.ts";
import { isRateLimited, rateLimitSeconds } from "../../apps/web/src/shared/rate-limit.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
// The web package's own query library instance, as in dashboard-blocks.test.ts.
const { QueryObserver } = require("@tanstack/react-query");
const limited = (seconds: number | null) => new AccountFailure("limited", seconds);
const clients: ReturnType<typeof createAppQueryClient>[] = [];
function client() {
  const value = createAppQueryClient();
  clients.push(value);
  return value;
}
afterEach(() => {
  for (const value of clients.splice(0)) value.clear();
});

test("the shared helper recognizes only rate limits and only a 1-60 second wait", () => {
  expect(isRateLimited(limited(5))).toBe(true);
  expect(isRateLimited({ kind: "limited" })).toBe(true);
  for (const value of [null, undefined, "limited", 429, {}, new AccountFailure("unavailable", 5)])
    expect(isRateLimited(value)).toBe(false);
  expect(rateLimitSeconds(limited(1))).toBe(1);
  expect(rateLimitSeconds(limited(60))).toBe(60);
  expect(rateLimitSeconds({ kind: "limited", retryAfter: 17 })).toBe(17);
  // Longer waits are not shortened to fit the read window; they are simply unknown here.
  for (const value of [
    limited(null),
    limited(0),
    limited(61),
    limited(3600),
    { kind: "limited", retryAfter: 1.5 },
    { kind: "limited", retryAfter: "5" },
    { kind: "limited" },
    new AccountFailure("unavailable", 5),
  ])
    expect(rateLimitSeconds(value)).toBeNull();
});

test("a 429 with a known wait retries once after exactly that wait, even with retry disabled", async () => {
  vi.useFakeTimers();
  const queryFn = vi.fn().mockRejectedValueOnce(limited(1)).mockResolvedValueOnce("synthetic-read");
  const result = client().fetchQuery({ queryKey: ["synthetic", 1], retry: false, queryFn });
  await vi.advanceTimersByTimeAsync(999);
  expect(queryFn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(queryFn).toHaveBeenCalledTimes(2);
  await expect(result).resolves.toBe("synthetic-read");
});

test("a second 429 is not retried again and the failure reaches the caller", async () => {
  vi.useFakeTimers();
  const queryFn = vi.fn().mockRejectedValue(limited(2));
  const result = client().fetchQuery({ queryKey: ["synthetic", 2], retry: false, queryFn });
  const settled = result.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10000);
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(rateLimitSeconds(await settled)).toBe(2);
});

test.each([
  ["another failure", new AccountFailure("unavailable", 5)],
  ["a 429 without a wait", limited(null)],
  ["a 429 with a long wait", limited(3600)],
])("%s keeps the query's own disabled retry", async (_name, error) => {
  vi.useFakeTimers();
  const queryFn = vi.fn().mockRejectedValue(error);
  const settled = client()
    .fetchQuery({ queryKey: ["synthetic", 3], retry: false, queryFn })
    .catch((value: unknown) => value);
  await vi.advanceTimersByTimeAsync(120000);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(await settled).toBe(error);
});

test("readers that schedule their own wait opt out with meta.rateLimitRetry false", async () => {
  vi.useFakeTimers();
  const queryFn = vi.fn().mockRejectedValue(limited(1));
  const settled = client()
    .fetchQuery({
      queryKey: ["synthetic", 4],
      meta: { private: true, rateLimitRetry: false },
      retry: false,
      queryFn,
    })
    .catch((value: unknown) => value);
  await vi.advanceTimersByTimeAsync(5000);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(rateLimitSeconds(await settled)).toBe(1);
});

test("other failures keep a numeric or function retry policy and its delay", async () => {
  vi.useFakeTimers();
  const numeric = vi.fn().mockRejectedValue(new AccountFailure("unavailable"));
  const first = client()
    .fetchQuery({ queryKey: ["synthetic", 5], retry: 2, retryDelay: 10, queryFn: numeric })
    .catch(() => null);
  await vi.advanceTimersByTimeAsync(100);
  await first;
  expect(numeric).toHaveBeenCalledTimes(3);
  const policy = vi.fn((failures: number) => failures < 1);
  const custom = vi.fn().mockRejectedValue(new AccountFailure("uncertain"));
  const second = client()
    .fetchQuery({ queryKey: ["synthetic", 6], retry: policy, retryDelay: 10, queryFn: custom })
    .catch(() => null);
  await vi.advanceTimersByTimeAsync(100);
  await second;
  expect(custom).toHaveBeenCalledTimes(2);
  expect(policy).toHaveBeenCalledTimes(2);
});

test("an observed query stays pending while it waits for its one rate-limit retry", async () => {
  vi.useFakeTimers();
  const queryFn = vi.fn().mockRejectedValueOnce(limited(3)).mockResolvedValueOnce("synthetic-read");
  const observer = new QueryObserver(client(), {
    queryKey: ["synthetic", 7],
    retry: false,
    queryFn,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await vi.advanceTimersByTimeAsync(2999);
    expect(observer.getCurrentResult()).toMatchObject({
      status: "pending",
      fetchStatus: "fetching",
      failureCount: 1,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(observer.getCurrentResult()).toMatchObject({
      status: "success",
      data: "synthetic-read",
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
  }
});

test("the rate-limit notice has the same RU/EN keys with the wait placeholder", () => {
  expect(Object.keys(core.ru.rateLimit).sort()).toEqual(Object.keys(core.en.rateLimit).sort());
  expect(Object.keys(core.en.rateLimit).sort()).toEqual(["title", "wait", "waitUnknown"]);
  for (const locale of [core.en, core.ru]) {
    expect(locale.rateLimit.wait).toContain("{{seconds}}");
    expect(locale.rateLimit.waitUnknown).not.toContain("{{");
  }
});
