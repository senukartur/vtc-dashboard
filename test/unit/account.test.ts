import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { createApp } from "../../apps/api/src/app.ts";
import { browserSchemaDocument, browserSchemaRef } from "@vtc/contracts/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, expect, test, vi } from "vitest";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import {
  attemptFor,
  command,
  readSelf,
  operations,
} from "../../apps/web/src/features/account/transport.ts";
import { clearPrivateQueries, createAppQueryClient } from "../../apps/web/src/app/session-cache.ts";
const meta = { requestId: "synthetic-request" };
const receipt = { data: { id: fixtureId, version: 1 }, meta };
const csrf = { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta };
afterEach(() => vi.unstubAllGlobals());
test("account fixtures and response parsers agree with the approved generated wire schemas", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats.default(ajv);
  ajv.addSchema(browserSchemaDocument);
  for (const locale of ["ru", "en"] as const) {
    expect(ajv.compile(browserSchemaRef("EnvelopeSelf"))(accountFixture(locale))).toBe(true);
    expect(operations.login.schema.safeParse(accountFixture(locale)).success).toBe(true);
  }
  expect(operations.recovery.schema.safeParse({ data: { status: "received" }, meta }).success).toBe(
    true,
  );
  expect(operations.emailCurrent.status).toBe(202);
  expect(operations.emailProposed.status).toBe(200);
});
test("early inline ingress scrubs supported router variants before resources without redeeming or persisting", () => {
  const html = readFileSync("apps/web/index.html", "utf8");
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(Boolean(source)).toBe(true);
  expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf("<script>"));
  expect(html.indexOf("history.replaceState")).toBeLessThan(html.indexOf('type="module"'));
  for (const path of [
    "/invitation",
    "/INVITATION/",
    "/%69nvitation///",
    "/password-reset",
    "/Password%2dReset/",
  ]) {
    const window = {};
    const replaceState = vi.fn();
    runInNewContext(source ?? "", {
      URL,
      decodeURIComponent,
      window,
      location: {
        href: `https://example.invalid${path}?token=NONFUNCTIONAL_FIXTURE&other=discard#private`,
      },
      history: { replaceState },
    });
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      null,
      "",
      decodeURIComponent(path).toLowerCase().replace(/\/+$/, ""),
    );
    expect(Object.keys(window)).toEqual([]);
  }
});
test("bootstrap accepts the actual invitation/reset generation UUID.secret format once and rejects malformed proof", async () => {
  for (const path of ["/invitation", "/password-reset"]) {
    const token = `${fixtureId}.${"x".repeat(43)}`;
    vi.resetModules();
    vi.stubGlobal("window", { __vtcLink: { path, token } });
    const ingress = await import("../../apps/web/src/features/account/link.ts");
    expect("__vtcLink" in window).toBe(false);
    expect(ingress.takeLink()).toEqual({ path, token });
    expect(ingress.takeLink().token).toBeNull();
    vi.resetModules();
    vi.stubGlobal("window", { __vtcLink: { path, token: "x".repeat(43) } });
    expect(
      (await import("../../apps/web/src/features/account/link.ts")).takeLink().token,
    ).toBeNull();
  }
});
test("built account deep links carry early referrer/noindex protection without reflecting query inputs", async () => {
  const app = await createApp({
    checkReadiness: async () => false,
    webRoot: resolve("apps/web/dist"),
  });
  try {
    for (const path of [
      "/login",
      "/account",
      "/invitation?token=NONFUNCTIONAL_FIXTURE",
      "/password-reset?token=NONFUNCTIONAL_FIXTURE",
    ]) {
      const response = await app.inject({ url: path, headers: { accept: "text/html" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("NONFUNCTIONAL_FIXTURE");
      expect(response.body.indexOf("history.replaceState")).toBeLessThan(
        response.body.indexOf('type="module"'),
      );
    }
  } finally {
    await app.close();
  }
});
test("memory attempts clone payloads, retain original keys for uncertain retries, and expire or change explicitly", () => {
  const payload = { email: "member@example.invalid" };
  const first = attemptFor("recovery", payload, undefined, null, 0);
  payload.email = "changed@example.invalid";
  expect(first.payload).toEqual({ email: "member@example.invalid" });
  expect(attemptFor("recovery", { email: "member@example.invalid" }, undefined, first, 1)).toBe(
    first,
  );
  expect(attemptFor("recovery", payload, undefined, first, 1).key).not.toBe(first.key);
  expect(
    attemptFor("recovery", { email: "member@example.invalid" }, undefined, first, first.expires)
      .key,
  ).not.toBe(first.key);
});
test("transport rotates current CSRF, sends bodyless writes correctly and uses ETag/idempotency with no automatic retry", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(csrf))
    .mockResolvedValueOnce(Response.json(receipt));
  vi.stubGlobal("fetch", fetcher);
  await command(attemptFor("logout", undefined, undefined, null), new AbortController().signal);
  expect(fetcher.mock.calls[1]?.[1]).not.toHaveProperty("body");
  expect(fetcher.mock.calls[1]?.[1].headers).not.toHaveProperty("Content-Type");
  expect(fetcher.mock.calls[1]?.[1].headers).not.toHaveProperty("Idempotency-Key");
  const attempt = attemptFor("preferences", { locale: "ru" }, '"v7"', null);
  fetcher
    .mockResolvedValueOnce(Response.json(csrf))
    .mockResolvedValueOnce(Response.json({ data: { locale: "ru", displayTimezone: "UTC" }, meta }));
  await command(attempt, new AbortController().signal);
  expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
    method: "PATCH",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "If-Match": '"v7"',
      "Idempotency-Key": attempt.key,
      "X-CSRF-Token": csrf.data.token,
    },
  });
});
test.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [409, "conflict"],
  [422, "invalid"],
  [429, "limited"],
  [503, "unavailable"],
  [500, "uncertain"],
])("safe status %s never reads a private error body or retries", async (status, kind) => {
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
    command(
      attemptFor("recovery", { email: "member@example.invalid" }, undefined, null),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ kind });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("invalid and unavailable session responses never become a valid self DTO", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...accountFixture(), private: "PRIVATE_SENTINEL" })),
  );
  await expect(readSelf(new AbortController().signal)).rejects.toMatchObject({
    kind: "unavailable",
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("PRIVATE_SENTINEL")));
  await expect(readSelf(new AbortController().signal)).rejects.toMatchObject({
    message: "ACCOUNT_REQUEST_FAILED",
  });
});
test("session transition removes retained self/private DTOs and mutation history, aborting even an ignored late response", async () => {
  const client = createAppQueryClient();
  const key = ["account-session", 1];
  await client.fetchQuery({
    queryKey: key,
    meta: { private: true },
    queryFn: async () => accountFixture(),
  });
  client.setQueryData(["public-safe"], "public");
  let release = (_value: string) => {};
  let aborted = false;
  const late = client
    .fetchQuery({
      queryKey: ["private-A", 1],
      meta: { private: true },
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    })
    .catch(() => undefined);
  clearPrivateQueries(client);
  release("PRIVATE_SENTINEL");
  await late;
  expect(aborted).toBe(true);
  expect(client.getQueryData(key)).toBeUndefined();
  expect(client.getQueryData(["private-A", 1])).toBeUndefined();
  expect(client.getMutationCache().getAll()).toEqual([]);
  expect(client.getQueryData(["public-safe"])).toBe("public");
  client.clear();
});
test("a stalled session read reaches a bounded safe unavailable result and external disposal aborts it", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new Error("PRIVATE_ABORT_DETAIL")),
          );
        }),
    ),
  );
  const delayed = readSelf(new AbortController().signal);
  const assertion = expect(delayed).rejects.toMatchObject({ kind: "unavailable" });
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  const controller = new AbortController();
  const disposed = readSelf(controller.signal);
  const disposedAssertion = expect(disposed).rejects.toMatchObject({ kind: "unavailable" });
  controller.abort();
  await disposedAssertion;
});
