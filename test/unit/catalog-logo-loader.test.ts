import { expect, test } from "vitest";
import {
  createLogoLoader,
  LogoUnavailable,
} from "../../apps/web/src/features/catalogs/logo-loader.ts";

type Pending = { url: string; answer: (response: Response | Error) => void };

/** A fetch whose answers the test hands out one by one. */
function controlledFetch() {
  const pending: Pending[] = [];
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (url: string) => {
    calls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<Response>((resolve, reject) => {
      pending.push({
        url,
        answer: (response) => {
          inFlight -= 1;
          if (response instanceof Error) reject(response);
          else resolve(response);
        },
      });
    });
  };
  return { fetch, pending, calls, maxInFlight: () => maxInFlight };
}

const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
const busy = (retryAfter?: string) =>
  new Response("{}", {
    status: 503,
    headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
  });
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function loader(fetch: (url: string) => Promise<Response>, waits: number[] = []) {
  let n = 0;
  return createLogoLoader({
    fetch,
    concurrency: 3,
    attempts: 3,
    wait: async (ms) => {
      waits.push(ms);
    },
    toObjectUrl: () => {
      n += 1;
      return `blob:logo-${n}`;
    },
    jitter: () => 0,
  });
}

test("a page of logos keeps at most three requests in flight and loads every one", async () => {
  const f = controlledFetch();
  const logos = loader(f.fetch);
  const requests = Array.from({ length: 10 }, (_, i) => logos.request(`/logo/${i}?v=a`));
  await flush();
  expect(f.pending).toHaveLength(3);
  while (f.pending.length > 0) {
    f.pending.shift()?.answer(png());
    await flush();
  }
  await expect(Promise.all(requests.map((r) => r.promise))).resolves.toHaveLength(10);
  expect(f.calls).toHaveLength(10);
  expect(f.maxInFlight()).toBe(3);
});

test("a busy answer is retried after the server's Retry-After, then the logo loads", async () => {
  const f = controlledFetch();
  const waits: number[] = [];
  const request = loader(f.fetch, waits).request("/logo/a?v=1");
  await flush();
  f.pending.shift()?.answer(busy("2"));
  await flush();
  f.pending.shift()?.answer(png());
  await expect(request.promise).resolves.toMatch(/^blob:logo-/);
  expect(f.calls).toEqual(["/logo/a?v=1", "/logo/a?v=1"]);
  expect(waits).toEqual([2000]);
});

test("a network error is retried with backoff when no hint is given", async () => {
  const f = controlledFetch();
  const waits: number[] = [];
  const request = loader(f.fetch, waits).request("/logo/a?v=1");
  await flush();
  f.pending.shift()?.answer(new TypeError("network"));
  await flush();
  f.pending.shift()?.answer(busy());
  await flush();
  f.pending.shift()?.answer(png());
  await expect(request.promise).resolves.toMatch(/^blob:/);
  expect(waits).toEqual([500, 1000]);
});

test("a server that stays busy and a non-busy error both end without a logo", async () => {
  const f = controlledFetch();
  const logos = loader(f.fetch);
  const stuck = logos.request("/logo/busy?v=1");
  const broken = logos.request("/logo/broken?v=1");
  await flush();
  f.pending.find((p) => p.url.includes("broken"))?.answer(new Response("{}", { status: 500 }));
  for (let i = 0; i < 3; i += 1) {
    await flush();
    f.pending.find((p) => p.url.includes("busy"))?.answer(busy("1"));
    f.pending.splice(0, f.pending.length);
  }
  await expect(stuck.promise).rejects.toEqual(new LogoUnavailable(503));
  await expect(broken.promise).rejects.toEqual(new LogoUnavailable(500));
  expect(f.calls.filter((u) => u.includes("busy"))).toHaveLength(3);
  expect(f.calls.filter((u) => u.includes("broken"))).toHaveLength(1);
});

test("one logo shown in several rows is fetched once", async () => {
  const f = controlledFetch();
  const logos = loader(f.fetch);
  const first = logos.request("/logo/a?v=1");
  const second = logos.request("/logo/a?v=1");
  await flush();
  f.pending.shift()?.answer(png());
  const [a, b] = await Promise.all([first.promise, second.promise]);
  expect(a).toBe(b);
  expect(f.calls).toHaveLength(1);
});

test("a queued logo nobody waits for any more is never requested", async () => {
  const f = controlledFetch();
  const logos = loader(f.fetch);
  for (let i = 0; i < 3; i += 1) logos.request(`/logo/${i}?v=a`);
  const leaving = logos.request("/logo/leaving?v=a");
  const staying = logos.request("/logo/staying?v=a");
  leaving.release();
  await flush();
  while (f.pending.length > 0) {
    f.pending.shift()?.answer(png());
    await flush();
  }
  await expect(staying.promise).resolves.toMatch(/^blob:/);
  expect(f.calls).not.toContain("/logo/leaving?v=a");
  expect(f.calls).toHaveLength(4);
});

test("a logo that failed is fetched again when it is asked for later", async () => {
  const f = controlledFetch();
  const logos = loader(f.fetch);
  const first = logos.request("/logo/a?v=1");
  await flush();
  f.pending.shift()?.answer(new Response("{}", { status: 404 }));
  await expect(first.promise).rejects.toBeInstanceOf(LogoUnavailable);
  const again = logos.request("/logo/a?v=1");
  await flush();
  f.pending.shift()?.answer(png());
  await expect(again.promise).resolves.toMatch(/^blob:/);
  expect(f.calls).toHaveLength(2);
});
