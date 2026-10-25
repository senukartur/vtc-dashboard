import { expect, test } from "vitest";
import { withReadSlot } from "../../apps/web/src/shared/read-scheduler.ts";

test("bounded browser reads queue, cancel without starting and release capacity after success or failure", async () => {
  let active = 0,
    peak = 0,
    starts = 0;
  const releases: (() => void)[] = [];
  const work = () =>
    withReadSlot(new AbortController().signal, async () => {
      starts++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return starts;
    });
  const first = work(),
    second = work();
  await Promise.resolve();
  await Promise.resolve();
  expect(active).toBe(2);
  const cancelled = new AbortController();
  let ran = false;
  const skipped = withReadSlot(cancelled.signal, async () => {
    ran = true;
  });
  const rejected = expect(skipped).rejects.toBeDefined();
  cancelled.abort();
  await rejected;
  const third = work();
  expect(starts).toBe(2);
  releases.shift()?.();
  await first;
  await Promise.resolve();
  expect(starts).toBe(3);
  expect(ran).toBe(false);
  releases.shift()?.();
  releases.shift()?.();
  await Promise.all([second, third]);
  expect(peak).toBe(2);
  await expect(
    withReadSlot(new AbortController().signal, async () => {
      throw Error("SYNTHETIC_READ_FAILURE");
    }),
  ).rejects.toThrow("SYNTHETIC_READ_FAILURE");
  await expect(withReadSlot(new AbortController().signal, async () => "recovered")).resolves.toBe(
    "recovered",
  );
});

import { vi } from "vitest";
import { tripRead } from "../../apps/web/src/features/trips/transport.ts";

test("active read abort frees a slot and queued reads keep FIFO order", async () => {
  const activeAbort = new AbortController(),
    order: string[] = [];
  let releaseSecond: () => void = () => {};
  const first = withReadSlot(
    activeAbort.signal,
    () =>
      new Promise<void>((_resolve, reject) => {
        order.push("first");
        activeAbort.signal.addEventListener("abort", () => reject(activeAbort.signal.reason), {
          once: true,
        });
      }),
  );
  const second = withReadSlot(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        order.push("second");
        releaseSecond = resolve;
      }),
  );
  await Promise.resolve();
  await Promise.resolve();
  const third = withReadSlot(new AbortController().signal, async () => {
      order.push("third");
    }),
    fourth = withReadSlot(new AbortController().signal, async () => {
      order.push("fourth");
    });
  const denied = expect(first).rejects.toBeDefined();
  activeAbort.abort();
  await denied;
  await third;
  await fourth;
  releaseSecond();
  await second;
  expect(order).toEqual(["first", "second", "third", "fourth"]);
});
test("query/session cancellation removes an obsolete queued private request before fetch while the next identity can read", async () => {
  const releases: (() => void)[] = [];
  const hold = () =>
    withReadSlot(
      new AbortController().signal,
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
  const a = hold(),
    b = hold();
  await Promise.resolve();
  await Promise.resolve();
  const fetchMock = vi.fn(async (_input: string) =>
    Response.json({
      data: { items: [], nextCursor: null },
      meta: { requestId: "synthetic-current-session" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const old = new AbortController(),
      request = tripRead("/trips?scope=mine", "EnvelopeListTripSummary", old.signal);
    const cancelled = expect(request).rejects.toMatchObject({ kind: "unavailable" });
    old.abort();
    await cancelled;
    const current = tripRead(
      "/trips?scope=company",
      "EnvelopeListTripSummary",
      new AbortController().signal,
    );
    releases.shift()?.();
    await a;
    await current;
    releases.shift()?.();
    await b;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/trips?scope=company");
  } finally {
    for (const release of releases) release();
    await Promise.all([a, b]);
    vi.unstubAllGlobals();
  }
});
